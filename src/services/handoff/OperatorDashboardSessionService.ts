import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { OperatorIdentity } from './OperatorIdentityService.js';
import { OperatorIdentityService } from './OperatorIdentityService.js';

export interface DashboardSession { sessionId:string; csrfToken:string; identity:OperatorIdentity; expiresAt:Date; }
export class OperatorDashboardSessionService {
  private readonly sessions=new Map<string,{operatorId:string;csrfToken:string;expiresAt:Date}>();
  private readonly challenges=new Map<string,{csrfToken:string;expiresAt:Date}>();
  constructor(private readonly identities:OperatorIdentityService,private readonly ttlMinutes:number,private readonly clock:()=>Date=()=>new Date()){}
  create(token:string):DashboardSession|undefined{const identity=this.identities.authenticate(token);if(!identity)return undefined;const sessionId=randomUUID();const csrfToken=randomBytes(32).toString('base64url');const expiresAt=new Date(this.clock().getTime()+this.ttlMinutes*60000);this.sessions.set(sessionId,{operatorId:identity.id,csrfToken,expiresAt});return{sessionId,csrfToken,identity,expiresAt};}
  get(sessionId:string|undefined):DashboardSession|undefined{if(!sessionId)return undefined;const value=this.sessions.get(sessionId);if(!value)return undefined;const identity=this.identities.findActive(value.operatorId);if(value.expiresAt<=this.clock()||!identity){this.sessions.delete(sessionId);return undefined;}return{sessionId,csrfToken:value.csrfToken,identity,expiresAt:value.expiresAt};}
  verifyCsrf(session:DashboardSession,supplied:string|undefined):boolean{if(!supplied)return false;const a=Buffer.from(session.csrfToken);const b=Buffer.from(supplied);return a.length===b.length&&timingSafeEqual(a,b);}
  destroy(sessionId:string|undefined):void{if(sessionId)this.sessions.delete(sessionId);}
  createLoginChallenge(){const id=randomUUID();const csrfToken=randomBytes(32).toString('base64url');this.challenges.set(id,{csrfToken,expiresAt:new Date(this.clock().getTime()+300000)});return{id,csrfToken};}
  consumeLoginChallenge(id:string|undefined,supplied:string|undefined):boolean{if(!id||!supplied)return false;const value=this.challenges.get(id);this.challenges.delete(id);if(!value||value.expiresAt<=this.clock())return false;const a=Buffer.from(value.csrfToken),b=Buffer.from(supplied);return a.length===b.length&&timingSafeEqual(a,b);}
}
