//! SSE (Server-Sent Events) endpoint.
//!
//! Every connected frontend client subscribes to `/api/stream`.  The
//! handler holds the connection open and streams events from the
//! broadcast channel.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use super::state::{AppState, SseEvent};

/// `GET /api/stream` — subscribe to server-sent events.
///
/// Returns an endless SSE stream.  The connection stays open until the
/// client disconnects.
pub async fn stream_handler(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.sse_tx.subscribe();

    let stream = BroadcastStream::new(rx).filter_map(|result| {
        match result {
            Ok(SseEvent { event_type, data }) => {
                let data_str = serde_json::to_string(&data).unwrap_or_default();
                Some(Ok(Event::default().event(event_type).data(data_str)))
            }
            Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                tracing::warn!(skipped = n, "SSE client lagging");
                None // skip — client will catch up naturally
            }
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}
