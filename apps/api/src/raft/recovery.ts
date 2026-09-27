import { sessions } from "../store.js";
import { coreRestoreAll } from "../stores/core.js";
import { stRestoreAll } from "../stores/shortTerm.js";
import type { LogStore } from "./logStore.js";
import { sessionAgents, visibility } from "./stateMachine.js";
import { decodeSnapshot, restoreSnapshot } from "./snapshot.js";

export function recoverStateMachine(store: LogStore): number {
  sessions.clear();
  stRestoreAll([]);
  coreRestoreAll([]);
  visibility.clear();
  sessionAgents.clear();

  // console.log("recovering state machine");
  const latest = store.loadLatestSnapshot();
  // console.log("latest snapshot", latest);
  let snapshotIndex = 0;
  if (latest) {
    try {
      restoreSnapshot(decodeSnapshot(latest.data));
      snapshotIndex = latest.index;
    } catch {
      snapshotIndex = 0;
    }
  }
  // console.log("snapshotIndex", snapshotIndex);
  return snapshotIndex;
}
