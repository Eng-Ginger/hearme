// Standalone phone page served by the Lab (same origin, so BroadcastChannel links it to the Lab tab).
import { createRoot } from "react-dom/client";
import { PhoneApp } from "@hearme/receiver-pwa";
createRoot(document.getElementById("root")!).render(<PhoneApp />);
