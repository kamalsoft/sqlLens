"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

/** UX-B: a long task a screen is running, and how to stop it. */
export type RunningTask = { label: string; cancel: () => void };

type Guard = { tasks: RunningTask[]; setTasks: Dispatch<SetStateAction<RunningTask[]>> };

const LeaveGuardContext = createContext<Guard>({ tasks: [], setTasks: () => {} });

/** Holds the running tasks for the whole app, and warns before the tab is closed or reloaded while any runs. */
export function LeaveGuardProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  const running = tasks.length > 0;
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  return <LeaveGuardContext.Provider value={{ tasks, setTasks }}>{children}</LeaveGuardContext.Provider>;
}

export type RunningTasks = RunningTask & { many: boolean };

/**
 * Everything running now, as one task: its label names each one, and cancelling stops them all.
 * Several can run at once, for example an execution and a refactor in the Execute screen's popup.
 */

export function useRunningTask(): RunningTasks | null {
  const { tasks } = useContext(LeaveGuardContext);
  return useMemo(() => {
    if (tasks.length === 0) return null;
    // "An execution and a refactor": only the first label keeps its capital letter.
    const label = tasks.map((t, i) => (i === 0 ? t.label : t.label.charAt(0).toLowerCase() + t.label.slice(1))).join(" and ");
    return { label, many: tasks.length > 1, cancel: () => tasks.forEach((t) => t.cancel()) };
  }, [tasks]);
}

/**
 * Registers a long task while `active` is true, so leaving the screen asks first. `cancel` stops the task;
 * the latest one is always used, so callers may pass a new function on every render.
 */
export function useLeaveGuard(active: boolean, label: string, cancel: () => void) {
  const { setTasks } = useContext(LeaveGuardContext);
  const cancelRef = useRef(cancel);
  useEffect(() => {
    cancelRef.current = cancel;
  });
  useEffect(() => {
    if (!active) return;
    const task: RunningTask = { label, cancel: () => cancelRef.current() };
    setTasks((current) => [...current, task]);
    return () => setTasks((current) => current.filter((t) => t !== task));
  }, [active, label, setTasks]);
}
