# 開発・デプロイ運用

- `develop`: 開発中の変更を保存するブランチ。普段の修正はここにコミットする。
- `main`: 本番公開用。変更をまとめて確認したあと、プルリクエストで `develop` からマージする。
- VercelのProduction Branchは `main` のままにする。
- Vercel側で `develop` のPreviewビルドを抑制する。ブランチを作るだけではPreviewデプロイは止まらない。
- 公開時はVercelの利用枠とデプロイ状況を確認し、まとめて1回のデプロイを行う。

## Vercelの設定（手動）

Vercelのプロジェクト設定でIgnored Build Stepを利用し、Preview環境のビルドを抑制する。例：

```sh
if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi
```

Ignored Build Stepの仕様では終了コード0が「ビルドをスキップ」、1が「ビルドする」。
この設定はビルド実行を抑えるものであり、デプロイ作成回数そのものの上限を必ず回避できるわけではない。
Vercel側の設定が完了するまでは、`develop` へのpushでもPreviewデプロイが作成される可能性がある。
