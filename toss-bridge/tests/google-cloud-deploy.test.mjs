import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const script=readFileSync(new URL('../../infra/google-cloud/deploy-toss-bridge.sh',import.meta.url),'utf8');

test('Google Cloud deployment keeps credentials in Secret Manager',()=>{
  assert.match(script,/read -r -s -p 'Toss Client Secret/);
  assert.match(script,/gcloud secrets versions add dividend-os-toss-client-id --data-file=-/);
  assert.match(script,/gcloud secrets versions add dividend-os-toss-client-secret --data-file=-/);
  assert.match(script,/--set-secrets='TOSS_CLIENT_ID=dividend-os-toss-client-id:latest,TOSS_CLIENT_SECRET=dividend-os-toss-client-secret:latest'/);
  assert.doesNotMatch(script,/^TOSS_CLIENT_SECRET=['"]?[A-Za-z0-9][A-Za-z0-9_-]{10,}['"]?$/m);
});

test('Google Cloud deployment uses a fixed NAT egress and least runtime scale',()=>{
  assert.match(script,/gcloud compute addresses create/);
  assert.match(script,/--nat-external-ip-pool="\$\{STATIC_IP\}"/);
  assert.match(script,/--network="\$\{NETWORK_NAME\}"/);
  assert.match(script,/--subnet="\$\{SUBNET_NAME\}"/);
  assert.match(script,/--vpc-egress=all-traffic/);
  assert.match(script,/--service-account="\$\{RUNTIME_SA_EMAIL\}"/);
  assert.match(script,/--min-instances=0/);
  assert.match(script,/--max-instances=2/);
});

test('Google Cloud deployment requires cost confirmation and verifies read-only health',()=>{
  assert.match(script,/CONFIRM_CHARGES/);
  assert.match(script,/--allow-unauthenticated/);
  assert.match(script,/"\$\{SERVICE_URL\}\/health"/);
  assert.match(script,/'"mode":"read-only"'/);
  assert.match(script,/'"ordersEnabled":false'/);
  assert.match(script,/TOSS_ALLOWLIST_IP=/);
});
