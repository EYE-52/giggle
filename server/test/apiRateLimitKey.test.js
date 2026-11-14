const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { apiRateLimitKey } = require('../src/middlewares/apiRateLimitKey');
const { requireIdentityAuth } = require('../src/middlewares/authMiddleware');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const http = require('node:http');

test('general request limits separate signed users behind one IP and canonicalize the same account', t => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'synthetic-rate-limit-test-secret-000000000000';
  t.after(() => { if(previous===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=previous; });
  const first = '507f1f77bcf86cd799439011', second = '507f1f77bcf86cd799439012';
  const request = token => ({ip:'192.0.2.1',headers:{authorization:`Bearer ${token}`}});
  const token = (userId, options={}) => jwt.sign({userId}, process.env.JWT_SECRET, {expiresIn:'1h',...options});
  assert.equal(apiRateLimitKey(request(token(first))),`user:${first}`);
  assert.equal(apiRateLimitKey(request(token(second))),`user:${second}`);
  assert.equal(apiRateLimitKey(request(token(first.toUpperCase()))),`user:${first}`);
  assert.equal(apiRateLimitKey(request(jwt.sign({sub:first},process.env.JWT_SECRET))),`user:${first}`);
  for(const invalid of [token(first,{expiresIn:-1}),jwt.sign({userId:first},'wrong-signature'),token('not-an-account'),'broken']) {
    const req=request(invalid);
    req.user={userId:second};
    req.headers['x-user-id']=second;
    assert.equal(apiRateLimitKey(req),'ip:192.0.2.1');
    let status, next=false;
    requireIdentityAuth(req,{status(value){status=value;return this;},json(){}},()=>{next=true;});
    assert.equal(status,401,'limiter and API auth reject the same invalid identity');
    assert.equal(next,false);
  }
  assert.equal(apiRateLimitKey({ip:'192.0.2.1',headers:{}}),'ip:192.0.2.1');
  assert.equal(apiRateLimitKey({ip:'2001:db8:1234:56ab::1',headers:{}}),apiRateLimitKey({ip:'2001:db8:1234:56cd::2',headers:{}}),'unauthenticated IPv6 rotation within one /56 cannot create fresh budgets');
});

test('HTTP limiter keeps separate account budgets and combines invalid token traffic by IP', async t => {
  const previous=process.env.JWT_SECRET;
  process.env.JWT_SECRET='synthetic-http-rate-limit-secret-000000000000';
  t.after(()=>{if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;});
  const app=express();
  app.use(rateLimit({windowMs:60000,max:2,keyGenerator:apiRateLimitKey,validate:false}));
  app.get('/',(_req,res)=>res.sendStatus(200));
  const server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const token=userId=>jwt.sign({userId},process.env.JWT_SECRET,{expiresIn:'1h'});
  const first=token('507f1f77bcf86cd799439011'),second=token('507f1f77bcf86cd799439012');
  const status=async credential=>(await fetch(base,{headers:credential?{authorization:`Bearer ${credential}`}:{}})).status;
  assert.equal(await status(first),200);
  assert.equal(await status(first),200);
  assert.equal(await status(first),429);
  assert.equal(await status(second),200,'another user on the same loopback IP retains their budget');
  assert.equal(await status('invalid'),200);
  const expired=jwt.sign({userId:'507f1f77bcf86cd799439013'},process.env.JWT_SECRET,{expiresIn:-1});
  assert.equal(await status(expired),200);
  assert.equal(await status(),429,'invalid, expired and missing credentials share the IP counter');
});
