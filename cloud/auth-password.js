const enc = new TextEncoder();
const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
const random = () => crypto.randomUUID().replaceAll('-', '');
const statement = (db, query, ...args) => db.prepare(query).bind(...args);
const first = (db, query, ...args) => statement(db, query, ...args).first();
export const secretHash = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(value)))));
export function usernameValue(value) {
 const username = String(value || '').trim().normalize('NFKC');
 if (!/^[\p{L}\p{N}_-]{2,40}$/u.test(username)) throw new Error('账号请使用 2–40 位中文、字母、数字、下划线或短横线');
 return username;
}
export async function passwordHash(password, salt = random()) {
 if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new Error('密码请使用 8–128 个字符');
 const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
 const result = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256);
 return `pbkdf2$100000$${salt}$${hex(new Uint8Array(result))}`;
}
async function matches(password, stored) {
 if (!stored || !String(stored).startsWith('pbkdf2$100000$')) return false;
 const actual = await passwordHash(password, stored.split('$')[2]);
 let different = actual.length ^ stored.length; for(let i=0;i<actual.length;i++) different |= actual.charCodeAt(i) ^ (stored.charCodeAt(i)||0);
 return different === 0;
}
export async function credentialFor(db,userId,username,password,keepSessionHash=null) {
 const recoveryCode = random(), hash = await passwordHash(password);
 await statement(db,'INSERT INTO account_credentials(user_id,username,password_hash,recovery_hash,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,recovery_hash=excluded.recovery_hash,updated_at=excluded.updated_at',userId,usernameValue(username),hash,await secretHash(recoveryCode),Date.now()).run();
 if(keepSessionHash)await statement(db,'DELETE FROM sessions WHERE user_id=? AND token_hash<>?',userId,keepSessionHash).run();
 else await statement(db,'DELETE FROM sessions WHERE user_id=?',userId).run();
 return recoveryCode;
}
function sessionCookie(token,remember) { return `helix_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${remember?'; Max-Age=604800':''}`; }
function publicUser(row) {return {id:row.id,username:row.username,role:row.role,active:!!row.active,verified:!!row.verified};}
export async function passwordRoute(request, env, ctx) {
 const {json,body,requireUser,optionalUser,settings}=ctx;
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(path==='/api/auth/initialize-owner'&&method==='POST'){
  const owner=await requireUser(request,env,new Set(['owner'])),input=await body(request);
  if(await first(env.DB,'SELECT user_id FROM account_credentials WHERE user_id=?',owner.id))fail('站主账号已经完成设置',409);
  const username=usernameValue(input.username);
  if(username!=='13773172155')fail('站主账号使用指定的站主用户名');
  const recoveryCode=await credentialFor(env.DB,owner.id,username,input.password);
  return json({saved:true,user:{id:owner.id,username,role:'owner'},recovery_code:recoveryCode});
 }
 if (path === '/api/auth/session' || path === '/api/admin/session') {
  const user=await optionalUser(request,env), isAdmin=['owner','admin','editor'].includes(user?.role);
  return json({authenticated:path.startsWith('/api/admin')?isAdmin:!!user,user:user&&publicUser(user),username:user?.username||null,role:user?.role,auth_mode:'password',configured:true});
 }
 if (['/api/auth/register','/api/auth/login'].includes(path) && method==='POST') {
  const input=await body(request),username=usernameValue(input.username);
  let row=await first(env.DB,'SELECT u.*,c.username,c.password_hash FROM users u JOIN account_credentials c ON c.user_id=u.id WHERE c.username=? COLLATE NOCASE',username),recoveryCode;
  if(path.endsWith('/register')){
   if(row)throw new Error('这个账号已被使用');
   const id=random(),password=await passwordHash(input.password); recoveryCode=random();
   await env.DB.batch([
    statement(env.DB,'INSERT INTO users(id,email,role,active,verified,created_at) VALUES(?,?,?,?,?,?)',id,id+'@account.invalid','user',1,1,Date.now()),
    statement(env.DB,'INSERT INTO account_credentials VALUES(?,?,?,?,?)',id,username,password,await secretHash(recoveryCode),Date.now())
   ]);
   row={id,username,role:'user',active:1,verified:1};
  }else if(!row||!row.active||!await matches(input.password,row.password_hash))return json({error:'账号或密码不正确'},401);
  const token=random()+random(),remember=input.remember!==false;
  await statement(env.DB,'INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)',await secretHash(token),row.id,Date.now()+(remember?604800000:86400000)).run();
  return json({authenticated:true,user:publicUser(row),auth_mode:'password',...(recoveryCode?{recovery_code:recoveryCode}:{})},200,{'set-cookie':sessionCookie(token,remember)});
 }
 if(path==='/api/auth/reset-password'&&method==='POST'){
  const input=await body(request),username=usernameValue(input.username),row=await first(env.DB,'SELECT * FROM account_credentials WHERE username=? COLLATE NOCASE',username);
  if(!row||await secretHash(String(input.recovery_code||'').replace(/\s/g,''))!==row.recovery_hash)return json({error:'账号或恢复码不正确'},400);
  const recoveryCode=await credentialFor(env.DB,row.user_id,row.username,input.password);
  return json({reset:true,recovery_code:recoveryCode,message:'密码已更新，请保存新的恢复码。'});
 }
 if(path==='/api/auth/change-password'&&method==='POST'){
  const user=await requireUser(request,env),input=await body(request),row=await first(env.DB,'SELECT * FROM account_credentials WHERE user_id=?',user.id);
  if(!row||!await matches(input.current_password,row.password_hash))return json({error:'当前密码不正确'},400);
  const raw=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('helix_session='))?.slice(14);
  const recoveryCode=await credentialFor(env.DB,user.id,row.username,input.password,raw?await secretHash(raw):null);return json({reset:true,recovery_code:recoveryCode});
 }
 if(path==='/api/auth/logout'||path==='/api/admin/logout'){
  const raw=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('helix_session='))?.slice(14);
  if(raw)await statement(env.DB,'DELETE FROM sessions WHERE token_hash=?',await secretHash(raw)).run();
  return json({authenticated:false},200,{'set-cookie':sessionCookie('',false)+'; Max-Age=0'});
 }
 if(path.startsWith('/api/auth/'))return json({error:'请使用账号密码登录；旧账号请联系站主分配新账号和重置凭证。'},410);
 if((path==='/api/admin/users'||path==='/api/admin/owner')&&method==='GET'){
  const user=await requireUser(request,env,new Set(path.endsWith('/owner')?['owner']:['owner','admin']));
  const rows=(await statement(env.DB,'SELECT u.id,u.email,u.role,u.active,u.verified,c.username FROM users u LEFT JOIN account_credentials c ON c.user_id=u.id ORDER BY u.role,c.username').all()).results||[];
  const users=rows.map(row=>({...publicUser(row),username:row.username||''}));
  if(path.endsWith('/owner')){const site=await settings(env.DB);return json({users:users.map((u,i)=>({...u,legacy_email:rows[i].username?'':rows[i].email})),admin_count:users.filter(x=>x.role==='admin'&&x.active).length,admin_limit:site.admin_limit});}
  return json({users});
 }
 if((path==='/api/admin/users/save'||path==='/api/admin/users/reset-password'||path==='/api/admin/owner/admins')&&method==='POST'){
  const actor=await requireUser(request,env,new Set(['owner'])),input=await body(request),username=usernameValue(input.username);
  const existing=await first(env.DB,'SELECT u.*,c.username FROM users u LEFT JOIN account_credentials c ON c.user_id=u.id WHERE u.id=? OR c.username=? COLLATE NOCASE',input.id||input.user_id||'',username);
  if(existing?.role==='owner')throw new Error('站主账号请在个人设置修改密码');
  if(path.endsWith('/reset-password')){
   if(!existing)throw new Error('账号不存在');
   const password=input.password||random().slice(0,16),recoveryCode=await credentialFor(env.DB,existing.id,username,password);return json({saved:true,temporary_password:input.password?undefined:password,recovery_code:recoveryCode});
  }
  const role=path.endsWith('/admins')?'admin':input.role||'user',active=input.active===false?0:1;
  if(!['user','editor','admin'].includes(role))throw new Error('人员角色无效');
  const site=await settings(env.DB),count=await first(env.DB,"SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1");
  if(role==='admin'&&active&&(existing?.role!=='admin'||!existing.active)&&site.admin_limit!==null&&count.n>=site.admin_limit)throw new Error('管理员名额已满');
  if(path.endsWith('/admins')&&!existing)throw new Error('请让对方先注册账号，再输入账号添加管理员');
  const id=existing?.id||random();
  if(existing)await statement(env.DB,'UPDATE users SET role=?,active=? WHERE id=?',role,active,id).run();
  else await statement(env.DB,'INSERT INTO users VALUES(?,?,?,?,?,?)',id,id+'@account.invalid',role,active,1,Date.now()).run();
  let recoveryCode,password;
  if(!existing?.username||input.password){password=input.password||random().slice(0,16);recoveryCode=await credentialFor(env.DB,id,username,password);}
  else if(existing.username!==username)await statement(env.DB,'UPDATE account_credentials SET username=? WHERE user_id=?',username,id).run();
  if(!active)await statement(env.DB,'DELETE FROM sessions WHERE user_id=?',id).run();
  return json({saved:true,id,username,...(recoveryCode?{recovery_code:recoveryCode,temporary_password:input.password?undefined:password}:{})});
 }
 const remove=path.match(/^\/api\/admin\/owner\/admins\/([^/]+)$/);
 if((path==='/api/admin/users/remove'&&method==='POST')||(remove&&method==='DELETE')){
  const actor=await requireUser(request,env,new Set(['owner'])),input=remove?{username:decodeURIComponent(remove[1])}:await body(request);
  const target=await first(env.DB,'SELECT u.id,u.role FROM users u LEFT JOIN account_credentials c ON c.user_id=u.id WHERE u.id=? OR c.username=? COLLATE NOCASE',input.id||input.user_id||'',input.username||'');
  if(!target)return json({removed:true});if(target.role==='owner')throw new Error('请保留站主账号');
  await statement(env.DB,"UPDATE users SET role='user',active=0 WHERE id=?",target.id).run();await statement(env.DB,'DELETE FROM sessions WHERE user_id=?',target.id).run();return json({removed:true});
 }
 return null;
}
