import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);

// Debug / e2e handle (read-only use: tests inspect engine state and alert history).
import { engine } from "./sim/engine";
import { store } from "./state/store";
import { camCtl } from "./scene/cameraControl";
(window as unknown as { __hearme: unknown }).__hearme = { engine, store, camCtl };
