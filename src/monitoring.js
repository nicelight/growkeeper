/** Notification readiness is not evidence that a message was delivered. */
import {now,assert} from './lib.js';
export async function monitoringStatus(store) {
 const stamp=now();
 const sub=await store.first('SELECT expires_at,verified_at FROM subscriptions WHERE user_id=?',store.user.id);
 const preference=await store.first('SELECT declined,last_offered_at,shortcut_offered_at FROM monitoring_preferences WHERE user_id=?',store.user.id);
 const pending=await store.first("SELECT COUNT(*) AS count FROM followups f JOIN plants p ON p.id=f.plant_id WHERE f.user_id=? AND p.deleting=0 AND f.status='PENDING'",store.user.id);
 const enabled=store.env.EVENTS_ENABLED==='true';
 const active=!!(enabled&&sub?.verified_at&&sub.expires_at>stamp);
 const state=!enabled?'disabled':active?'active':sub&&sub.expires_at<=stamp?'expired':'missing';
 const declined=!!preference?.declined;
 const alreadyOffered=!!preference?.last_offered_at && !(state==='expired'&&preference.last_offered_at<sub.expires_at);
 return {state,expires_at:sub?.expires_at||null,pending_checks:pending.count,offer_declined:declined,
  should_offer:enabled&&!active&&pending.count>0&&!declined&&!alreadyOffered,
  should_offer_shortcut:active&&!preference?.shortcut_offered_at,
  event:'growkeeper.followup_due',requires_user_consent:true};
}
export async function recordMonitoringChoice(store,a) {
 assert(['offered','declined','reset','shortcut_offered'].includes(a.choice),'MONITORING_CHOICE','Unknown monitoring choice.');
 const stamp=now();
 if(a.choice==='shortcut_offered')await store.run(`INSERT INTO monitoring_preferences(user_id,declined,shortcut_offered_at,updated_at) VALUES(?,0,?,?) ON CONFLICT(user_id) DO UPDATE SET shortcut_offered_at=COALESCE(monitoring_preferences.shortcut_offered_at,excluded.shortcut_offered_at),updated_at=excluded.updated_at`,store.user.id,stamp,stamp);
 else if(a.choice==='offered')await store.run(`INSERT INTO monitoring_preferences(user_id,declined,last_offered_at,updated_at) VALUES(?,0,?,?) ON CONFLICT(user_id) DO UPDATE SET last_offered_at=excluded.last_offered_at,updated_at=excluded.updated_at`,store.user.id,stamp,stamp);
 else await store.run(`INSERT INTO monitoring_preferences(user_id,declined,last_offered_at,updated_at) VALUES(?,?,NULL,?) ON CONFLICT(user_id) DO UPDATE SET declined=excluded.declined,last_offered_at=NULL,updated_at=excluded.updated_at`,store.user.id,a.choice==='declined'?1:0,stamp);
 return {monitoring:await monitoringStatus(store)};
}
