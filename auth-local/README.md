# auth-local — ログイン（API 接続済み試作）

本番ドメイン・owner 本登録・GitHub push は未実施です。

## ローカル確認

```bash
# 例
npx netlify dev
# または静的 + Functions 相当の環境で
# http://127.0.0.1:8888/auth-local/login.html
```

必要な環境変数はリポジトリルートの `.env.example` を参照（値はコミットしない）。

推奨ローカル設定:

```
AUTH_ENFORCEMENT_MODE=off
AUTH_RP_ID=localhost
AUTH_ALLOWED_ORIGINS=http://127.0.0.1:8888,http://localhost:8888
AUTH_COOKIE_SECURE=0
AUTH_EMAIL_PROVIDER=console
AUTH_TEST_EXPOSE_EMAIL_TOKEN=1
AUTH_BOOTSTRAP_ENABLED=1
AUTH_BOOTSTRAP_OWNER_EMAIL=（開発用メール）
```

## テスト

```bash
npm run test:auth
```

## 関連ドキュメント

- [auth-security-design.md](../docs/architecture/auth-security-design.md)
- [auth-implementation-plan.md](../docs/architecture/auth-implementation-plan.md)
- [auth-cutover-and-recovery.md](../docs/architecture/auth-cutover-and-recovery.md)
- [auth-api-permissions.md](../docs/architecture/auth-api-permissions.md)
