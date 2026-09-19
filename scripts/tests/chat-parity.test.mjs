import test from 'node:test';
import assert from 'node:assert/strict';
import { historyVisible, canSaveMessage, createHistoryReceipts } from '../../app/chat/history.js';
import { viewOncePresentation } from '../../app/chat/view-once.js';
const message = { id: 'm', room_sequence: 1, kind: 'text', status: 'active', delivery_state: 'sent' };
const storage = () => { const data = new Map(); return { get length(){return data.size}, key:n=>[...data.keys()][n], getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k) }; };
test('server deadlines hide unsaved content while preserving Mementos and disallowing ephemeral saves', () => {
 assert.equal(historyVisible({...message,history_expires_at:new Date(100).toISOString()},101),false);
 assert.equal(historyVisible({...message,status:'history_cleared'}),false);
 assert.equal(historyVisible({...message,kind:'memento',history_expires_at:new Date(100).toISOString()},101),true);
 assert.equal(canSaveMessage(message),true);
 for(const patch of [{view_once:true},{kind:'memento'},{kind:'story'},{delivery_state:'sending'},{status:'deleted_by_author'}]) assert.equal(canSaveMessage({...message,...patch}),false);
});
test('native view-once labels distinguish sender, fresh, current-session replay, consumed and expired', () => {
 const m={kind:'photo',view_once:true,view_once_remaining_views:2,view_once_available:true};
 assert.equal(viewOncePresentation(m).label,'Tap to view');
 assert.equal(viewOncePresentation({...m,view_once_remaining_views:1}).label,'Opened');
 assert.equal(viewOncePresentation({...m,view_once_remaining_views:1},{canReplay:true}).label,'Hold to replay');
 assert.equal(viewOncePresentation({...m,view_once_remaining_views:1},{canReplay:true,armed:true}).label,'Tap to replay');
 assert.equal(viewOncePresentation({...m,view_once_remaining_views:0,view_once_available:false}).label,'Opened');
 assert.equal(viewOncePresentation({...m,view_once_available:false}).label,'Expired');
 assert.equal(viewOncePresentation({...m,viewer_is_sender:true}).label,'Delivered');
 assert.equal(viewOncePresentation({...m,viewer_is_sender:true,view_once_opened_count:2,view_once_recipient_count:2}).label,'Opened by everyone');
});
test('exact view receipts survive a failed exit and recover after a crashed lease, without ending another live tab', async () => {
 const saved=storage(), calls=[];let fail=false,now=1000;
 const api={user:{id:'user'},recordChatHistoryViews:async(u,c,sequences,ended)=>{calls.push({u,c,sequences,ended});if(fail)throw Error('offline');return{ok:true};}};
 const first=createHistoryReceipts({api,userId:'user',storage:saved,now:()=>now,sessionId:'one'});
 first.viewed('chat',[1,2,2,0,3.5]);await first.flush();
 assert.deepEqual(calls[0],{u:'user',c:'chat',sequences:[1,2],ended:false});
 const second=createHistoryReceipts({api,userId:'user',storage:saved,now:()=>now,sessionId:'two'});await second.flush();assert.equal(calls.length,1);await second.close();
 fail=true;await first.close();assert(saved.length>0);
 now+=121000;fail=false;
 const recovered=createHistoryReceipts({api,userId:'user',storage:saved,now:()=>now,sessionId:'three'});await recovered.flush();
 assert.deepEqual(calls.at(-1),{u:'user',c:'chat',sequences:[1,2],ended:true});assert.equal(saved.length,0);await recovered.close();
});
test('view receipts chunk at 200 and never cross an account switch', async () => {
 const calls=[];const api={user:{id:'a'},recordChatHistoryViews:async(u,c,seq,ended)=>{calls.push({u,seq,ended});return{ok:true};}};
 const receipts=createHistoryReceipts({api,userId:'a',storage:storage()});receipts.viewed('chat',Array.from({length:450},(_,i)=>i+1));await receipts.flush();assert.deepEqual(calls.map(c=>c.seq.length),[200,200,50]);api.user={id:'b'};await receipts.close();assert.equal(calls.length,3);
});
