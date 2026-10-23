# Figure Tournament

独立したNext.jsアプリの画面試作です。既存の `ningyogeki-stats` や `smash-stage-selector` には依存せず、どちらのリポジトリも変更しません。

## ローカルで起動
Node.js 20.9以上を用意し、このフォルダで実行します。

```bash
npm install
npm run dev
```

http://localhost:3000 で表示できます。

## 今あるもの
- 大会一覧・検索・状態フィルター
- 大会詳細モーダル
- 大会作成フォームの見た目
- ステージストライクと戦績アーカイブへの入口
- スマホ対応レイアウト

大会データはサンプルです。参加登録、保存、ログイン、データ連携は未実装です。

## 公開について
このプロジェクトを新しいGitHubリポジトリ `figure-tournament` に登録し、Vercelで新規プロジェクトとしてImportすれば、既存サイトとは別アプリとして公開できます。
