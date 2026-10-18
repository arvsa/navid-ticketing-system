use std::net::SocketAddr;

use backend::{authz::permission, db, http, jobs, realtime, telemetry, AppState, Config};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let config = Config::from_env()?;
    telemetry::init(config.log_format);

    let pool = db::connect(&config).await?;
    db::migrate(&pool).await?;
    tracing::info!("migrations applied");
    permission::verify_catalog(&pool).await?;

    let bind_addr = config.bind_addr;
    let jobs_enabled = config.jobs_enabled;
    let state = AppState::new(pool.clone(), config);
    realtime::listener::spawn(pool.clone(), state.realtime.clone());
    if jobs_enabled {
        jobs::spawn(pool);
    }
    let app = http::router(state);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(%bind_addr, "listening");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}
