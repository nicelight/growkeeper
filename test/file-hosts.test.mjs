import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedURL,urlDiagnostic} from '../src/lib.js';
test('photo-only subdomain allowlist accepts regional storage and rejects lookalikes',()=>{
 const csv='*.oaiusercontent.com';
 for(const host of ['sdmntpreastus2.oaiusercontent.com','files.oaiusercontent.com','a.b.oaiusercontent.com'])assert.equal(allowedURL('https://'+host+'/photo',csv,'FILE_HOST_NOT_ALLOWED',true),'https://'+host+'/photo');
 for(const url of ['https://oaiusercontent.com/photo','https://eviloaiusercontent.com/photo','https://oaiusercontent.com.evil.example/photo','http://files.oaiusercontent.com/photo','https://user:pass@files.oaiusercontent.com/photo','https://files.oaiusercontent.com:444/photo','https://files.oaiusercontent.com/photo#frag'])assert.throws(()=>allowedURL(url,csv,'FILE_HOST_NOT_ALLOWED',true));
 assert.throws(()=>allowedURL('https://sdmntpreastus2.oaiusercontent.com/photo',csv,'WEBHOOK_HOST_NOT_ALLOWED'));
 assert.equal(urlDiagnostic('https://sdmntpreastus2.oaiusercontent.com/photo',csv,true).host_allowed,true);
});
