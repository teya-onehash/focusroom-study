# Native WebRTC configuration

Mellow Commons uses `RTCPeerConnection` for media and private Supabase Realtime Broadcast/Presence channels for ephemeral signaling. Supabase does not relay or store call media.

## TURN for production

The browser currently uses the public STUN entries in `config.js`. STUN is enough on many home and mobile networks, but a TURN relay is required for dependable calling behind restrictive campus, corporate, carrier-grade NAT, or firewall configurations.

1. Choose a managed TURN provider or operate Coturn.
2. Create a Supabase Edge Function that authenticates the caller and requests short-lived TURN credentials from the provider. Store provider secrets with Supabase Edge Function secrets only.
3. Return JSON in this shape:

   ```json
   {
     "iceServers": [
       {
         "urls": ["turn:relay.example.com:3478?transport=udp", "turns:relay.example.com:5349?transport=tcp"],
         "username": "short-lived-user",
         "credential": "short-lived-password"
       }
     ]
   }
   ```

4. Set `WEBRTC_TURN_FUNCTION` in `config.js` to the Edge Function name.

Never put a permanent TURN shared secret, Supabase service-role key, or provider API key in browser code. Credentials returned to the browser should have a short TTL. Include UDP TURN, TCP TURN, and TLS TURN endpoints for the broadest network compatibility.

## Signaling topics

- Public rooms: `study-room:public:<room-id>`
- Private rooms: `study-room:private:<room-id>`
- Direct calls: `dm-call:<call-id>`

Realtime Authorization policies on `realtime.messages` validate the authenticated user against the public-room visit, private-room membership, or DM-call participants before allowing Broadcast or Presence access.

## Public room scale

Public study rooms have no application-level participant cap. Realtime Presence keeps the full authenticated room roster and connected count, including when more people are present than can safely share media in a browser mesh.

To prevent upload bandwidth and peer-connection count from growing quadratically, clients are placed deterministically into WebRTC stream circles of up to six people. This is a media topology boundary, not a room-entry limit: everyone can join, everyone appears in the People list, and each student sees a stable live circle. Duplicate tabs are collapsed to one account in the roster.

If the product later needs every participant to receive the same large-stage video mix, replace the peer mesh with an SFU. Supabase Realtime can continue to provide authorized Presence and application events, but an SFU should own large-room media forwarding.
