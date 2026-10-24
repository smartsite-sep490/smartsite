# Local camera configuration reference commissioning

MF05/MF06 camera Regions can request a current configuration JPEG without
starting model inference. This is a configuration reference, not PPE evidence.

## Verified local slice

- Backend/Web remain qualified Main585 / bd91985 with Main66 migrations.
- The owner approved local `demo.manager`, SITE_MANAGER only at the demo Site.
  Existing `demo123` ADMIN/global credentials and roles remain unchanged.
- Actual native device0 maps to `laptop-webcam-live`, camera
  `993d35dd-e3fe-461b-ba3f-93e1e6f5f518`. Hardware identity is operator-selected.
- The existing private Tapo source also returned an actual configuration image
  through the website for `tapo-core5-live`, camera
  `1660ce78-1042-4b28-947b-f5f003eedaf8`, configuration version3, 1280x720.
  Its credential file is never exposed to the browser or committed.
- Authenticated configuration-image HTTP returned LIVE / REGION_CONFIGURATION,
  configuration version3, matching camera/Site and exact JPEG hash, 640x480.
- Unauthorized reads return401; Manager global-user administration returns403;
  an uncommissioned replay camera remains503. No role bypass.
- Agy's composition test covers selecting the second camera, explicit image
  request, drawing enabled after decoding, and logout abort/late-response clear.
  Root ran2 focused cases, Web typecheck and file lint successfully. Browser
  decoding is mocked in that test; Root separately viewed the actual HTTP JPEG.

## Lifetime and recovery

The configuration-only AI host uses AI commit f4f02bc, controlled STOP-file
drain, physical-resource lease and bounded session lifetime. It loads no model.
The website writes the owned source STOP on normal shutdown; reboot is not a
graceful shutdown. The 03:00VN reboot interrupted the prior runtime. PostgreSQL
performed its normal crash recovery; all92 application tables matched the last
snapshot exactly, including accounts, Regions and retained selections. No DDL,
restore or seed was used for this recovery.

Before attaching both sources, the prior website and all four owned native
processes exited0 through STOP; both native release receipts were verified.
The new runtime retains the same database and deadline, with two configuration
sources/four Python processes and zero model/inference workers. A separate
qualified source snapshot preserves the exact two Main585 UI source hashes
while Agy works on those files; unreviewed edits are not in the served bundle.

Read the latest checkpoint and actual owner guard before operating the demo.
Current runtime receipts and credentials are private D-drive artifacts. Never
commit them or substitute this operational note for a live ownership check.

## Remaining acceptance

Other sources require commissioning; metadata ACTIVE does not mean online.
No YOLO inference, PPE alert notification, MF06 trusted identity/authority,
browser rendering, soak/capacity or whole-product acceptance is claimed here.
