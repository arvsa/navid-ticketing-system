//! `POST /api/branches/{id}/members/import`: adds many people to a branch from
//! an Excel workbook (xlsx, xls, ods) or a CSV file.
//!
//! The first non-empty row names the columns: `email`, `first_name` and
//! `last_name`, in any order, in English or Farsi. Each later row is planned
//! exactly like `POST /branches/{id}/members`: a new account, an account from
//! another branch, a departed member coming back, or someone already here
//! (skipped). A dry run returns that plan. A real run writes every row in one
//! transaction, and only when no row has an error: all or nothing. With
//! `skip_errors`, the rows with an error are left out and the rest go in.

use std::{collections::HashMap, io::Cursor};

use calamine::{open_workbook_auto_from_rs, Reader};
use rust_xlsxwriter::{Format, Workbook};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    branches::{emit_branch_event, validate_email},
    members::{apply_join, find_user, plan_join, Join},
};
use crate::{
    auth::password::{self, Password},
    authz::{authorize, Action, Actor},
    error::{AppError, AppResult},
};

/// Each new account is hashed with Argon2; this keeps an import well inside
/// the upload timeout.
pub const MAX_ROWS: usize = 500;
pub const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ImportOutcome {
    /// A new account.
    Create,
    /// An account from another branch.
    Add,
    /// A departed member comes back.
    Reactivate,
    /// Already a member; left as they are.
    Skip,
    /// Blocks the import; see `error`.
    Error,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct RowError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ImportRow {
    /// The row number in the file, counting the header.
    pub row: u32,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub outcome: ImportOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RowError>,
    /// Set once imported.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<Uuid>,
    /// Only for new accounts once imported, shown once.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temporary_password: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ImportReport {
    /// False for a dry run, or when any row has an error and they weren't
    /// skipped (nothing was written).
    pub imported: bool,
    pub rows: Vec<ImportRow>,
}

pub async fn run(
    db: &PgPool,
    actor: &Actor,
    branch_id: Uuid,
    file: &[u8],
    dry_run: bool,
    skip_errors: bool,
) -> AppResult<ImportReport> {
    // A plain member gets 403, not a report of forbidden rows.
    authorize(actor, Action::AddMember { branch_id, existing: None })?;
    let parsed = parse(file)?;

    let mut rows = Vec::with_capacity(parsed.len());
    let mut joins = Vec::with_capacity(parsed.len());
    let mut seen: HashMap<String, u32> = HashMap::new();
    for p in parsed {
        let planned = match validate_email(&p.email) {
            Err(e) => Err(e),
            Ok(email) => match seen.get(&email.to_lowercase()) {
                Some(first) => Err(AppError::validation("duplicate_email", format!("the same email is on row {first}"))),
                None => {
                    seen.insert(email.to_lowercase(), p.row);
                    let existing = find_user(db, &email).await?;
                    plan_join(actor, branch_id, existing.as_ref(), Some(&p.first_name), Some(&p.last_name))
                        .map(|join| (email, join))
                }
            },
        };
        let (outcome, error, join) = match planned {
            Ok((email, join)) => {
                let outcome = match join {
                    Join::AlreadyMember => ImportOutcome::Skip,
                    Join::Reactivate(_) => ImportOutcome::Reactivate,
                    Join::Add(_) => ImportOutcome::Add,
                    Join::Create { .. } => ImportOutcome::Create,
                };
                (outcome, None, Some((email, join)))
            }
            Err(e @ AppError::Internal(_)) => return Err(e),
            Err(e) => (ImportOutcome::Error, Some(RowError { code: e.code(), message: e.to_string() }), None),
        };
        rows.push(ImportRow {
            row: p.row,
            email: p.email,
            first_name: p.first_name,
            last_name: p.last_name,
            outcome,
            error,
            user_id: None,
            temporary_password: None,
        });
        joins.push(join);
    }

    if dry_run || (!skip_errors && rows.iter().any(|r| r.outcome == ImportOutcome::Error)) {
        return Ok(ImportReport { imported: false, rows });
    }

    // Hash every new account's password in parallel, before the transaction.
    let mut hashing = Vec::new();
    for join in &joins {
        hashing.push(match join {
            Some((_, Join::Create { .. })) => {
                let temp = password::generate_temporary();
                let for_hash = temp.clone();
                Some((temp, tokio::task::spawn_blocking(move || password::hash(&for_hash))))
            }
            _ => None,
        });
    }
    let mut passwords: Vec<Option<(Password, String)>> = Vec::with_capacity(hashing.len());
    for h in hashing {
        passwords.push(match h {
            Some((temp, task)) => Some((temp, task.await.map_err(AppError::internal)??)),
            None => None,
        });
    }

    let mut tx = db.begin().await?;
    let mut changed = Vec::new();
    for ((row, join), password) in rows.iter_mut().zip(&joins).zip(passwords) {
        let Some((email, join)) = join else { continue };
        if matches!(join, Join::AlreadyMember) {
            continue;
        }
        let pair = password.as_ref().map(|(p, h)| (p.expose(), h.as_str()));
        let user_id = apply_join(&mut tx, actor, branch_id, email, join, pair).await?;
        row.user_id = Some(user_id);
        row.temporary_password = password.map(|(p, _)| p.expose().to_owned());
        changed.push(user_id);
    }
    if !changed.is_empty() {
        // The schema trigger has put them in "All members".
        emit_branch_event(&mut tx, "member_changed", branch_id, changed).await?;
    }
    tx.commit().await?;
    Ok(ImportReport { imported: true, rows })
}

#[derive(Debug, PartialEq)]
struct ParsedRow {
    row: u32,
    email: String,
    first_name: String,
    last_name: String,
}

#[derive(Clone, Copy)]
enum Column {
    Email,
    FirstName,
    LastName,
}

/// Header names, compared without case, spaces, `-`, `_` or ZWNJ.
fn column(header: &str) -> Option<Column> {
    let key: String = header
        .chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '-' | '_' | '.' | '\u{200c}'))
        .flat_map(char::to_lowercase)
        .collect();
    match key.as_str() {
        "email" | "emailaddress" | "mail" | "ایمیل" | "رایانامه" | "پستالکترونیک" | "پستالکترونیکی" => {
            Some(Column::Email)
        }
        "firstname" | "givenname" | "first" | "name" | "نام" | "اسم" => Some(Column::FirstName),
        "lastname" | "surname" | "familyname" | "last" | "نامخانوادگی" | "فامیلی" | "فامیل" => {
            Some(Column::LastName)
        }
        _ => None,
    }
}

fn invalid(message: impl Into<std::borrow::Cow<'static, str>>) -> AppError {
    AppError::validation("invalid_import", message)
}

fn parse(file: &[u8]) -> AppResult<Vec<ParsedRow>> {
    if file.len() > MAX_BYTES {
        return Err(AppError::PayloadTooLarge { message: "import files are limited to 2 MB".into() });
    }
    // Excel files are zip (xlsx, ods) or OLE (xls) containers; anything else
    // is read as CSV text.
    let table = if file.starts_with(b"PK\x03\x04") || file.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
        read_workbook(file)?
    } else {
        let text = std::str::from_utf8(file)
            .map_err(|_| invalid("save the file as an Excel workbook or a UTF-8 CSV"))?;
        read_csv(text.strip_prefix('\u{feff}').unwrap_or(text))
    };
    rows_from_table(table)
}

/// Each cell with its row number, counting from 1.
type Table = Vec<(u32, Vec<String>)>;

fn read_workbook(file: &[u8]) -> AppResult<Table> {
    let mut book =
        open_workbook_auto_from_rs(Cursor::new(file)).map_err(|_| invalid("the file isn't a readable Excel workbook"))?;
    let range = book
        .worksheet_range_at(0)
        .ok_or_else(|| invalid("the workbook has no sheets"))?
        .map_err(|_| invalid("the first sheet can't be read"))?;
    let first_row = range.start().map_or(0, |(r, _)| r);
    let first_col = range.start().map_or(0, |(_, c)| c) as usize;
    Ok(range
        .rows()
        .enumerate()
        .map(|(i, cells)| {
            // Keep column positions when the used range doesn't start at A.
            let mut row = vec![String::new(); first_col];
            row.extend(cells.iter().map(|c| c.to_string()));
            (first_row + i as u32 + 1, row)
        })
        .collect())
}

/// RFC 4180 with quotes. The delimiter is whichever of `,` `;` or tab is most
/// common in the first line (Excel saves `;` in some locales).
fn read_csv(text: &str) -> Table {
    let first_line = text.lines().next().unwrap_or_default();
    let delimiter =
        [',', ';', '\t'].into_iter().max_by_key(|d| first_line.matches(*d).count()).unwrap_or(',');
    let mut table = Vec::new();
    let (mut row, mut cell) = (Vec::new(), String::new());
    let (mut line, mut row_start) = (1u32, 1u32);
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                chars.next();
                cell.push('"');
            }
            '"' => quoted = !quoted,
            '\n' if !quoted => {
                row.push(std::mem::take(&mut cell));
                table.push((row_start, std::mem::take(&mut row)));
                line += 1;
                row_start = line;
            }
            '\r' if !quoted => {}
            c if c == delimiter && !quoted => row.push(std::mem::take(&mut cell)),
            c => {
                if c == '\n' {
                    line += 1;
                }
                cell.push(c);
            }
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        table.push((row_start, row));
    }
    table
}

fn rows_from_table(table: Table) -> AppResult<Vec<ParsedRow>> {
    let blank = |cells: &[String]| cells.iter().all(|c| c.trim().is_empty());
    let mut rows = table.into_iter().filter(|(_, cells)| !blank(cells));
    let (_, header) = rows.next().ok_or_else(|| invalid("the file is empty"))?;
    let mut cols: [Option<usize>; 3] = [None; 3];
    for (i, name) in header.iter().enumerate() {
        if let Some(col) = column(name) {
            cols[col as usize].get_or_insert(i);
        }
    }
    let [Some(email), first, last] = cols else {
        return Err(invalid("the first row must name the columns: email, first_name, last_name"));
    };
    let cell = |cells: &[String], i: Option<usize>| i.and_then(|i| cells.get(i)).map_or("", |c| c.trim()).to_owned();
    let parsed: Vec<ParsedRow> = rows
        .map(|(row, cells)| ParsedRow {
            row,
            email: cell(&cells, Some(email)),
            first_name: cell(&cells, first),
            last_name: cell(&cells, last),
        })
        .collect();
    if parsed.is_empty() {
        return Err(invalid("the file has no people in it, only the header row"));
    }
    if parsed.len() > MAX_ROWS {
        return Err(invalid(format!("import at most {MAX_ROWS} people at a time")));
    }
    Ok(parsed)
}

/// An empty workbook with the header row, for people to fill in.
pub fn template() -> AppResult<Vec<u8>> {
    let mut book = Workbook::new();
    let sheet = book.add_worksheet();
    let bold = Format::new().set_bold();
    let text = Format::new().set_num_format("@");
    let write = |sheet: &mut rust_xlsxwriter::Worksheet| -> Result<(), rust_xlsxwriter::XlsxError> {
        sheet.set_name("People")?;
        for (col, name) in ["email", "first_name", "last_name"].into_iter().enumerate() {
            sheet.write_with_format(0, col as u16, name, &bold)?;
            sheet.set_column_width(col as u16, if col == 0 { 34 } else { 22 })?;
            sheet.set_column_format(col as u16, &text)?;
        }
        sheet.set_freeze_panes(1, 0)?;
        Ok(())
    };
    write(sheet).map_err(AppError::internal)?;
    book.save_to_buffer().map_err(AppError::internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(row: u32, email: &str, first: &str, last: &str) -> ParsedRow {
        ParsedRow { row, email: email.into(), first_name: first.into(), last_name: last.into() }
    }

    #[test]
    fn csv_with_quotes_bom_and_blank_lines() {
        let csv = "\u{feff}Last Name,E-mail,First name\r\n\"O\"\"Brien\",a@x.org,Ann\r\n\r\n\"Doe, Jr\",b@x.org,\"Bo\nB\"\n";
        assert_eq!(
            parse(csv.as_bytes()).unwrap(),
            vec![row(2, "a@x.org", "Ann", "O\"Brien"), row(4, "b@x.org", "Bo\nB", "Doe, Jr")]
        );
    }

    #[test]
    fn farsi_headers_and_semicolons() {
        let csv = "ایمیل;نام;نام‌خانوادگی\nc@x.org;سارا;احمدی";
        assert_eq!(parse(csv.as_bytes()).unwrap(), vec![row(2, "c@x.org", "سارا", "احمدی")]);
    }

    #[test]
    fn needs_an_email_column_and_rows() {
        assert_eq!(parse(b"name,surname\nA,B").unwrap_err().code(), "invalid_import");
        assert_eq!(parse(b"email\n\n").unwrap_err().code(), "invalid_import");
        assert_eq!(parse(b"").unwrap_err().code(), "invalid_import");
    }

    #[test]
    fn reads_the_template_back() {
        let file = template().unwrap();
        // Header only.
        assert_eq!(parse(&file).unwrap_err().to_string(), "the file has no people in it, only the header row");
    }
}
