//! Operator CLI. Needs only `DATABASE_URL`.
//!
//! ```text
//! cargo run --bin admin -- create-super-admin --email x --first-name y --last-name z
//! cargo run --bin admin -- reset-password --email x
//! cargo run --bin admin -- seed-demo          # demo data, empty databases only
//! ```

use backend::{auth::bootstrap, db, seed};
use clap::{Parser, Subcommand};
use sqlx::postgres::PgPoolOptions;

#[derive(Parser)]
#[command(about = "School ticketing admin tasks")]
struct Cli {
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: String,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create a super admin and print a one-time temporary password.
    CreateSuperAdmin {
        #[arg(long)]
        email: String,
        #[arg(long)]
        first_name: String,
        #[arg(long)]
        last_name: String,
    },
    /// Set a temporary password, force a change at next login, and sign the user out everywhere.
    ResetPassword {
        #[arg(long)]
        email: String,
    },
    /// Fill an empty database with demo branches, people and issues.
    SeedDemo,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let pool = PgPoolOptions::new().max_connections(2).connect(&cli.database_url).await?;
    db::migrate(&pool).await?;

    if let Command::SeedDemo = cli.command {
        let seeded = seed::demo(&pool).await?;
        println!("Seeded {} branches, {} users and {} issues.", seeded.branches, seeded.users, seeded.issues);
        println!();
        println!("  Super admin:  {}", seed::DEMO_SUPER_ADMIN);
        println!("  Branch admin: admin@north.demo.school (also south, east)");
        println!("  Members:      member1@north.demo.school .. member{}@...", seed::MEMBERS_PER_BRANCH);
        println!("  Password:     {} (for every demo account)", seed::DEMO_PASSWORD);
        return Ok(());
    }

    let (email, created) = match cli.command {
        Command::CreateSuperAdmin { email, first_name, last_name } => {
            let created = bootstrap::create_super_admin(&pool, &email, &first_name, &last_name).await?;
            println!("Created super admin {email} ({})", created.user_id);
            (email, created)
        }
        Command::ResetPassword { email } => {
            let created = bootstrap::reset_password(&pool, &email).await?;
            println!("Reset the password of {email} ({}); their sessions were signed out", created.user_id);
            (email, created)
        }
        Command::SeedDemo => unreachable!("handled above"),
    };
    println!();
    println!("  Temporary password: {}", created.temporary_password.expose());
    println!();
    println!("It is shown only once. {email} must choose a new password after signing in.");
    Ok(())
}
