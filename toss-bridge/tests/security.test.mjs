import assert from 'node:assert/strict';
import test from 'node:test';
import {authorizeOwnerClaims,bearerToken,isAllowedReadPath,parseAllowedOrigins,safeBridgeError,validateEnvironment} from '../security.mjs';

const env={TOSS_CLIENT_ID:'client',TOSS_CLIENT_SECRET:'secret',FIREBASE_PROJECT_ID:'project-1',ALLOWED_FIREBASE_UID:'owner_uid'};

test('environment and exact HTTPS origins',()=>{
  assert.doesNotThrow(()=>validateEnvironment(env));
  assert.throws(()=>validateEnvironment({...env,TOSS_CLIENT_SECRET:''}));
  assert.deepEqual([...parseAllowedOrigins('https://dttg123.github.io,https://app.example.com')],['https://dttg123.github.io','https://app.example.com']);
  assert.throws(()=>parseAllowedOrigins('http://insecure.example.com'));
});

test('bearer and owner-only claims',()=>{
  assert.equal(bearerToken('Bearer abc.def-_~'), 'abc.def-_~');
  assert.equal(bearerToken('Basic abc'), '');
  const claims={aud:'project-1',iss:'https://securetoken.google.com/project-1',sub:'owner_uid',exp:2000,iat:900,auth_time:900};
  assert.equal(authorizeOwnerClaims(claims,env,1000).ok,true);
  assert.deepEqual(authorizeOwnerClaims({...claims,sub:'other_uid'},env,1000),{ok:false,status:403,code:'owner-only'});
  assert.equal(authorizeOwnerClaims({...claims,exp:999},env,1000).status,401);
  assert.equal(authorizeOwnerClaims({...claims,aud:'other-project'},env,1000).status,401);
});

test('only required read paths and safe public errors',()=>{
  for(const path of ['/api/v1/accounts','/api/v1/holdings','/api/v1/orders?status=CLOSED','/api/v1/prices?symbols=MSTY'])assert.equal(isAllowedReadPath(path),true);
  for(const path of ['/api/v1/orders/new','/api/v1/orders/cancel','/oauth2/token'])assert.equal(isAllowedReadPath(path),false);
  assert.deepEqual(safeBridgeError({status:401,message:'upstream secret detail'}),{status:502,code:'bridge-not-configured',message:'토스 중계 서버 인증 설정을 확인해야 합니다.'});
  assert.equal(JSON.stringify(safeBridgeError({status:500,message:'sensitive'})).includes('sensitive'),false);
});
