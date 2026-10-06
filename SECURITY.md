# Security

Player code runs in a Judge0 sandbox, never on the application server. If you find a way around that, or any other vulnerability, please tell us privately first.

- Email: security@codearena.co
- Please include steps to reproduce and the version or commit you tested.
- You will get an acknowledgement within a few days. We will tell you when the fix ships and credit you if you want.

Please do not open a public issue for a security problem, and do not test against accounts that are not yours on codearena.co.

The `CODEARENA_RUNNER=local` mode runs code on the host with no sandbox. It exists for development only and refuses to start when `NODE_ENV=production`.
