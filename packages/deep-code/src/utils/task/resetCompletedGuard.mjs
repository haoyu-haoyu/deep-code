// The hide-timer auto-reset (useTasksV2 #onHideTimerFired) wipes the whole task
// list once every visible task is completed. The "are they all still completed?"
// decision MUST be made on the set re-listed UNDER the task-list lock that the
// destructive delete then holds — not on an earlier unlocked snapshot.
//
// THE BUG it guards: the old code listed tasks WITHOUT the lock, decided
// "all completed", then called resetTaskList (which locks and unconditionally
// unlinks every *.json). A concurrent TaskCreate that landed AFTER the unlocked
// snapshot but BEFORE the locked delete (both serialize on the same .lock) wrote
// a fresh `pending` task that the stale snapshot never saw — and the delete wiped
// it. The model was told "Task #N created successfully", yet it vanished
// permanently. Verify-and-delete must be ONE locked critical section.
//
// This is the exact predicate the hook used inline (length>0 && every completed),
// now applied to the on-lock re-listed set. The length>0 gate is load-bearing:
// an empty list must NOT trigger a reset.
//
// @param {ReadonlyArray<{status?: string}>} tasks
// @returns {boolean}
export function shouldResetCompletedTaskList(tasks) {
  return tasks.length > 0 && tasks.every(t => t.status === 'completed')
}
