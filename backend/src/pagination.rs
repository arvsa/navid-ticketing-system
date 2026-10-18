//! Keyset pagination: `?after=<cursor>&limit=50` (max 200) on every list.
//! The cursor is the sort key of the last row, hex-encoded JSON; clients
//! treat it as opaque.

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const DEFAULT_LIMIT: i64 = 50;
pub const MAX_LIMIT: i64 = 200;

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PageParams {
    /// Opaque cursor from the previous page's `next_cursor`.
    pub after: Option<String>,
    /// 1-200, default 50.
    pub limit: Option<i64>,
}

impl PageParams {
    pub fn limit(&self) -> AppResult<i64> {
        match self.limit {
            None => Ok(DEFAULT_LIMIT),
            Some(n) if (1..=MAX_LIMIT).contains(&n) => Ok(n),
            Some(_) => Err(AppError::validation("invalid_limit", format!("limit must be between 1 and {MAX_LIMIT}"))),
        }
    }

    pub fn cursor<T: DeserializeOwned>(&self) -> AppResult<Option<T>> {
        self.after.as_deref().map(decode).transpose()
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

impl<T> Page<T> {
    /// `rows` must have been fetched with `LIMIT limit + 1`; the extra row
    /// only signals that another page exists.
    pub fn from_rows<K: Serialize>(mut rows: Vec<T>, limit: i64, key: impl Fn(&T) -> K) -> Self {
        let has_more = rows.len() as i64 > limit;
        rows.truncate(limit as usize);
        let next_cursor = if has_more { rows.last().map(|r| encode(&key(r))) } else { None };
        Self { items: rows, next_cursor }
    }
}

fn encode<K: Serialize>(key: &K) -> String {
    let json = serde_json::to_vec(key).expect("cursor keys serialize");
    json.iter().map(|b| format!("{b:02x}")).collect()
}

fn decode<T: DeserializeOwned>(cursor: &str) -> AppResult<T> {
    let invalid = || AppError::validation("invalid_cursor", "the pagination cursor is invalid");
    if !cursor.len().is_multiple_of(2) || cursor.len() > 2048 {
        return Err(invalid());
    }
    let bytes = (0..cursor.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&cursor[i..i + 2], 16))
        .collect::<Result<Vec<u8>, _>>()
        .map_err(|_| invalid())?;
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}
