import { test, expect } from '@playwright/test';
async function signIn(page) {
 await page.goto('/app/?demo=1&signin=1');
 await page.getByRole('button',{name:/^sign in$/i}).click();
 await page.getByRole('button',{name:'Chats',exact:true}).click();
}
async function room(page){await page.getByRole('button',{name:/Noah Williams/}).click();await expect(page.locator('[data-message-id="msg-n4"]')).toBeVisible();}

test('shared history setting saves only after confirmation, reconciles, and supports Save in chat',async({page})=>{
 await signIn(page);
 await page.evaluate(async()=>{
  const {DemoAPI}=await import('/app/demo-api.js');
  const original=DemoAPI.prototype.setChatHistory;
  window.historyPuts=[];
  DemoAPI.prototype.setChatHistory=async function(...args){window.historyPuts.push(args);return original.apply(this,args)};
 });
 await room(page);await page.getByRole('button',{name:'Chat settings',exact:true}).click();
 const choices=page.locator('[data-history-options]');
 await expect(choices.getByRole('button',{name:/Keep history/})).toBeEnabled();
 await expect(choices.getByRole('button',{name:/Keep history/})).toHaveAttribute('aria-pressed','true');
 page.once('dialog',d=>d.dismiss());await choices.getByRole('button',{name:/Clear after 24 hours/}).click();
 expect(await page.evaluate(()=>historyPuts.length)).toBe(0);
 page.once('dialog',d=>d.accept());await choices.getByRole('button',{name:/Clear after 24 hours/}).click();
 await expect(choices.getByRole('button',{name:/Clear after 24 hours/})).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>historyPuts[0].slice(1))).toEqual(['chat-noah','after24Hours']);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 const message=page.locator('[data-message-id="msg-n3"]');
 await message.getByRole('button',{name:'Message actions'}).click();
 await message.getByRole('button',{name:'Save in chat',exact:true}).click();
 await expect(message.locator('.chat-saved-label')).toHaveText('Saved by Jules');
 await message.getByRole('button',{name:'Message actions'}).click();
 await message.getByRole('button',{name:'Unsave',exact:true}).click();
 await expect(message.locator('.chat-saved-label')).toHaveCount(0);
});

test('retention reports only visible messages, sends ended receipts on tab exit, and expires offline',async({page})=>{
 await signIn(page);
 await page.evaluate(async()=>{
  const {DemoAPI}=await import('/app/demo-api.js');window.viewReceipts=[];
  DemoAPI.prototype.recordChatHistoryViews=async function(...args){viewReceipts.push(args);return{ok:true}};
  const original=DemoAPI.prototype.getChatMessages;
  DemoAPI.prototype.getChatMessages=async function(...args){const response=await original.apply(this,args);if(args[1]==='chat-noah'){this.chatMessages[args[1]].find(m=>m.id==='msg-n1').history_expires_at=new Date(Date.now()+3000).toISOString();response.items.find(m=>m.id==='msg-n1').history_expires_at=new Date(Date.now()+3000).toISOString();}return response};
 });
 await room(page);
 await expect.poll(()=>page.evaluate(()=>viewReceipts.some(r=>r[1]==='chat-noah'&&r[2].includes(4)&&r[3]===false))).toBe(true);
 await page.context().setOffline(true);
 await expect(page.locator('[data-message-id="msg-n1"]')).toHaveCount(0,{timeout:6000});
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>viewReceipts.some(r=>r[1]==='chat-noah'&&r[3]===true))).toBe(true);
});

test('view-once uses native labels, hold then tap replay, and loses replay after leaving the chat',async({page})=>{
 await signIn(page);await room(page);
 const message=page.locator('[data-message-id="msg-n4"]');
 await expect(message.locator('.chat-view-once-card')).toHaveCSS('width','174px');
 await message.getByRole('button',{name:'Photo · Tap to view',exact:true}).click();
 const viewer=page.getByRole('dialog',{name:'Chat media',exact:true});
 await expect(viewer.locator('.chat-ephemeral-progress')).toBeVisible();
 await viewer.getByRole('button',{name:'Close',exact:true}).click();
 const replay=message.getByRole('button',{name:'Photo · Hold to replay',exact:true});
 await replay.click();await expect(viewer).not.toBeVisible();
 const box=await replay.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await expect(message.getByRole('button',{name:'Photo · Tap to replay',exact:true})).toBeVisible();
 await page.mouse.up();await expect(viewer).not.toBeVisible();
 await page.getByRole('button',{name:'Back to chats'}).click();await room(page);
 await expect(message.getByRole('button',{name:'Photo · Opened',exact:true})).toBeDisabled();
});

test('photo playback pauses on hold and closes at its native five-second deadline',async({page})=>{
 await signIn(page);await room(page);
 await page.getByRole('button',{name:'Photo · Tap to view',exact:true}).click();
 const viewer=page.getByRole('dialog',{name:'Chat media',exact:true});
 await expect(viewer.locator('.chat-ephemeral-progress')).toBeVisible();
 await viewer.getByRole('button',{name:'Pause media'}).click();
 const value=await viewer.locator('progress').evaluate(n=>n.value);
 await page.waitForTimeout(300);expect(await viewer.locator('progress').evaluate(n=>n.value)).toBe(value);
 await viewer.getByRole('button',{name:'Resume media'}).click();
 await expect(viewer).not.toBeVisible({timeout:6500});
});

test('inbox has pending photo/video actions and Memento indicator; settings are grouped and feed outlined',async({page})=>{
 await page.goto('/app/?demo=1&signin=1');
 await page.evaluate(async()=>{
  const{DemoAPI}=await import('/app/demo-api.js');const original=DemoAPI.prototype.getChats;
  DemoAPI.prototype.getChats=async function(...args){const response=await original.apply(this,args);Object.assign(response.items.find(c=>c.id==='chat-noah'),{unopened_view_once_count:1,next_view_once_room_sequence:4,next_view_once_kind:'video'});return response};
 });
 await page.getByRole('button',{name:/^sign in$/i}).click();
 await expect(page.locator('#feedList > article').first()).toHaveCSS('border-top-width','3px');
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await expect(page.getByRole('region',{name:'System settings'}).getByRole('button',{name:'Activity status',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Chats',exact:true}).click();
 await expect(page.locator('[data-list-key="chat-friends"] .chat-needs-memento')).toBeVisible();
 await expect(page.locator('[data-pending-media="chat-noah"] i')).toHaveClass('video');
 await page.getByRole('button',{name:'View 1 unopened media item'}).click();
 await expect(page.getByRole('dialog',{name:'Chat media'})).toBeVisible();
 await page.getByRole('dialog',{name:'Chat media'}).getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.locator('[data-open-memento-gallery] [data-ui-icon="memento"]')).toBeVisible();
});

test('history API sends the existing shared contract and never claims a rejected save succeeded', async({page})=>{
 await page.goto('/app/?demo=1&signin=1');
 const calls=[];
 await page.route('**/api/v1/users/u/chats/c/**',async route=>{
  const r=route.request();calls.push({method:r.method(),path:new URL(r.url()).pathname,body:r.postData()?r.postDataJSON():null});
  await route.fulfill({json:{mode:'save',items:[],ok:true}});
 });
 await page.evaluate(async()=>{
  const {ValidAPI}=await import('/app/api.js');const api=new ValidAPI();
  await api.getChatHistory('u','c',18);await api.setChatHistory('u','c','afterLeaving');
  await api.recordChatHistoryViews('u','c',[19,21],true);await api.saveChatMessage('u','c','m',true);
 });
 expect(calls.map(c=>[c.method,c.path])).toEqual([
  ['GET','/api/v1/users/u/chats/c/history'],['PUT','/api/v1/users/u/chats/c/history'],
  ['POST','/api/v1/users/u/chats/c/history/viewed'],['PUT','/api/v1/users/u/chats/c/messages/m/saved'],
 ]);
 expect(calls[1].body).toEqual({mode:'afterLeaving'});expect(calls[2].body.sequences).toEqual([19,21]);expect(calls[2].body.ended).toBe(true);expect(calls[3].body.saved).toBe(true);
 await page.evaluate(async()=>{
  const {DemoAPI}=await import('/app/demo-api.js');DemoAPI.prototype.setChatHistory=async()=>{throw Error('offline')};
 });
 await page.getByRole('button',{name:/^sign in$/i}).click();await page.getByRole('button',{name:'Chats',exact:true}).click();await room(page);
 await page.getByRole('button',{name:'Chat settings',exact:true}).click();
 await expect(page.locator('[data-history-mode="afterLeaving"]')).toBeEnabled();
 page.once('dialog',d=>d.accept());await page.locator('[data-history-mode="afterLeaving"]').click();
 await expect(page.locator('[data-history-status]')).toContainText('couldn’t be confirmed');
 await expect(page.locator('[data-history-mode="save"]')).toHaveAttribute('aria-pressed','true');
});

test('view-once video plays real decoded media and closes at the end without consuming another view',async({page})=>{
 await signIn(page);
 await page.route('**/assets/demo.mp4',route=>route.fulfill({path:'tests/fixtures/view-once.mp4',contentType:'video/mp4'}));
 await page.evaluate(async()=>{
  const{DemoAPI}=await import('/app/demo-api.js');const get=DemoAPI.prototype.getChatMessages,start=DemoAPI.prototype.startChatMediaViewSession;window.videoStarts=0;
  DemoAPI.prototype.getChatMessages=async function(...args){if(args[1]==='chat-noah')this.chatMessages[args[1]].find(m=>m.id==='msg-n4').kind='video';return get.apply(this,args)};
  DemoAPI.prototype.startChatMediaViewSession=async function(...args){window.videoStarts++;return start.apply(this,args)};
 });
 await room(page);await page.getByRole('button',{name:'Video · Tap to view',exact:true}).click();
 const viewer=page.getByRole('dialog',{name:'Chat media',exact:true});
 await expect(viewer.locator('progress')).toBeVisible();
 await expect.poll(()=>viewer.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(0);
 await expect(viewer).not.toBeVisible({timeout:6000});
 expect(await page.evaluate(()=>videoStarts)).toBe(1);
 await expect(page.getByRole('button',{name:'Video · Hold to replay',exact:true})).toBeVisible();
});
