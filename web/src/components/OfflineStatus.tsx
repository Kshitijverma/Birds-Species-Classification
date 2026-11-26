import { useSyncExternalStore } from "react";
import { applyUpdate, getState, subscribe } from "../pwa";
import "./offline.css";

/** A quiet note in the footer on offline support, plus a slip asking to reload when a new version is ready. */
export function OfflineStatus() {
  const { offline, updateReady } = useSyncExternalStore(subscribe, getState);
  return (
    <>
      {offline !== "none" && (
        <span
          className={`offline-note ${offline}`}
          title={
            offline === "ready"
              ? "The site and the model are saved on this device, so identifying works without a connection."
              : "The site is saved on this device. The model is saved the first time you identify a photo."
          }
        >
          {offline === "ready" ? "Available offline" : "Offline after your first photo"}
        </span>
      )}
      {updateReady && (
        <div className="update-slip" role="status">
          Update ready —{" "}
          <button className="link" onClick={applyUpdate}>
            reload
          </button>
        </div>
      )}
    </>
  );
}
