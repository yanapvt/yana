import{execFileSync}from'node:child_process';
const expressions=['-----BEGIN '+'(RSA |EC |OPENSSH )?PRIVATE KEY-----','sk-'+'(proj-)?[A-Za-z0-9_-]{20,}','AKIA'+'[0-9A-Z]{16}'];
function git(args:string[]):string[]{try{return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split(/\r?\n/).filter(Boolean);}catch{return[];}}
const patternArgs=expressions.flatMap(value=>['-e',value]);
const current=git(['grep','-Il','-E',...patternArgs,'--','.']);
const templatePaths=current.filter(path=>['PRODUCTION_DEPLOYMENT.md','PRODUCTION_DEPLOYMENT_GCP.md'].includes(path));
const riskPaths=current.filter(path=>!templatePaths.includes(path));
const commits=git(['rev-list','--all']);
const history=new Map<string,number>();
for(const commit of commits){for(const result of git(['grep','-Il','-E',...patternArgs,commit,'--','.'])){const path=result.startsWith(`${commit}:`)?result.slice(commit.length+1):result;history.set(path,(history.get(path)??0)+1);}}
console.log(JSON.stringify({currentRiskPaths:riskPaths.sort(),currentTemplatePaths:templatePaths.sort(),historicalPaths:[...history].sort().map(([path,commitCount])=>({path,commitCount})),valuesPrinted:false},null,2));
if(riskPaths.length)process.exitCode=2;
