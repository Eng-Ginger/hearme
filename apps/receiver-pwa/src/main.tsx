import { createRoot } from "react-dom/client";
import { PhoneApp } from "./PhoneApp";
createRoot(document.getElementById("root")!).render(<PhoneApp />);
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => {});
