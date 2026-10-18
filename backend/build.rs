// Rebuild when migrations change: `sqlx::migrate!` embeds them at compile
// time, and Cargo doesn't otherwise notice a newly added file.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
