# Supabase setup

大会情報と参加登録を端末間で共有するため、Supabaseに大会テーブルを作成します。

## 1. テーブル作成

1. Supabaseでステージストライクが利用しているプロジェクトを開きます。
2. **SQL Editor** を開きます。
3. `supabase/schema.sql` の内容を貼り付けて実行します。

既存の `stage_rooms` テーブルは変更しません。このアプリは別の `tournaments` テーブルを使います。

## 2. Vercel環境変数

Figure TournamentのVercelプロジェクトの **Settings → Environment Variables** に次を登録し、Production（必要ならPreviewも）に適用します。

- `NEXT_PUBLIC_SUPABASE_URL`: SupabaseプロジェクトのProject URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabaseのservice_role secret key

`SUPABASE_SERVICE_ROLE_KEY` はサーバー専用の秘密鍵です。名前に `NEXT_PUBLIC_` を付けず、ブラウザ側のコードや公開リポジトリに書かないでください。ステージストライクの公開用キーをservice role keyの代わりに使わないでください。

登録後、Vercelで再デプロイします。

## 3. 動作確認

- 大会を作成し、大会一覧に表示されることを確認
- 別のスマホまたはシークレットウィンドウで一覧・詳細を開けることを確認
- 別端末から参加登録し、詳細ページを再読み込みして参加者が反映されることを確認
- 作成した端末では大会削除ができ、別端末では削除できないことを確認

## 注意

この実装では大会データの読み書きはNext.js API経由で行います。Supabaseのservice role keyはサーバーAPIでのみ使用します。
