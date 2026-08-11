CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'weex-trade-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--aec536ce-1436-47a1-8de7-49d6caa3be65.lovable.app/api/public/hooks/trade-tick',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_KcpPO-cRQAkcp9_Jhi1REg_-fVCCKF_"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);