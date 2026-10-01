import { createHash } from 'node:crypto';
export interface SecretFinding { path:string; kind:string; fingerprint:string; }
export function redactFinding(path:string,kind:string,value:string):SecretFinding{return{path,kind,fingerprint:createHash('sha256').update(value).digest('hex').slice(0,12)};}
export function summarizeFindings(findings:SecretFinding[]){return{count:findings.length,paths:[...new Set(findings.map(x=>x.path))].sort(),kinds:[...new Set(findings.map(x=>x.kind))].sort()};}
