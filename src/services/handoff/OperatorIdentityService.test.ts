import { describe, expect, it } from 'vitest';
import { hashOperatorCredential, OperatorIdentityService } from './OperatorIdentityService.js';
const id='11111111-1111-4111-8111-111111111111';
const row=(token:string,extra={})=>({id,tokenSha256:hashOperatorCredential(token),roles:['viewer'],revoked:false,...extra});
describe('OperatorIdentityService',()=>{
  it('supports rotation and least privilege without plaintext tokens',()=>{const service=new OperatorIdentityService(JSON.stringify([row('old'),row('new',{id:'22222222-2222-4222-8222-222222222222',roles:['admin']})])); expect(service.authenticate('new')?.id).toContain('2222'); expect(service.permits(service.authenticate('old')!,'operator')).toBe(false); expect(JSON.stringify(service)).not.toContain('old');});
  it('rejects revoked and expired identities',()=>{const now=()=>new Date('2026-01-02'); const service=new OperatorIdentityService(JSON.stringify([row('revoked',{revoked:true}),row('expired',{expiresAt:'2026-01-01'})]),now); expect(service.authenticate('revoked')).toBeUndefined(); expect(service.authenticate('expired')).toBeUndefined();});
});
