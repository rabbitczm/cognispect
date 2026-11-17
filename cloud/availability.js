export function databaseIssue(error){
 const text=String(error?.message||error||'');
 if(/(?:daily|per.day).*(?:read)|(?:read).*(?:daily|quota|limit)/i.test(text))return {code:'D1_READ_QUOTA',error:'今日数据库读取额度已用完，北京时间上午 8 点重置；已保存数据保留。',status:503};
 if(/(?:daily|per.day).*(?:writ)|(?:writ).*(?:daily|quota|limit)/i.test(text))return {code:'D1_WRITE_QUOTA',error:'今日数据库写入额度已用完，北京时间上午 8 点重置；未同步内容请保留在当前设备。',status:503};
 if(/SQLITE_FULL|database or disk is full|database.*(?:size|storage).*limit/i.test(text))return {code:'D1_STORAGE_FULL',error:'数据库存储已满，请站主清理不再需要的文件；已有数据保留。',status:507};
 if(/D1.*(?:limit|quota|too large|full)/i.test(text))return {code:'D1_LIMIT',error:'数据库暂时达到服务额度，请稍后重试；已有数据保留。',status:503};
 return {code:'DATABASE_UNAVAILABLE',error:'数据库连接暂未完成，公开演示版仍可使用；请稍后重试在线操作。',status:503};
}
