// Older clients can still reach this endpoint. It no longer holds or uses
// Spotify credentials. Current Viby builds import public playlists locally.
Deno.serve(() =>
  new Response(JSON.stringify({ error: 'Update Viby to import Spotify playlists.' }), {
    status: 410,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  })
)
