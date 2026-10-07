import { useEffect, useState } from "react";

// Pages live in the URL hash (#/repairs/12), so the browser back button and
// bookmarks work, and links can be shared on the tailnet.
export type Route =
  | { name: "dashboard" }
  | { name: "repairs"; filter?: string }
  | { name: "repair"; id: number }
  | { name: "customers"; filter?: string }
  | { name: "customer"; id: number }
  | { name: "parts" }
  | { name: "chat" }
  | { name: "settings"; section?: string };

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [section, id] = path.split("/");
  const filter = new URLSearchParams(query).get("filter") ?? undefined;
  const number = Number(id);
  switch (section) {
    case "repairs": return id && Number.isInteger(number) && number > 0 ? { name: "repair", id: number } : { name: "repairs", filter };
    case "customers": return id && Number.isInteger(number) && number > 0 ? { name: "customer", id: number } : { name: "customers", filter };
    case "parts": return { name: "parts" };
    case "chat": return { name: "chat" };
    case "settings": return id && /^[a-z]+$/.test(id) ? { name: "settings", section: id } : { name: "settings" };
    default: return { name: "dashboard" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "dashboard": return "#/";
    case "repairs": return route.filter ? `#/repairs?filter=${encodeURIComponent(route.filter)}` : "#/repairs";
    case "repair": return `#/repairs/${route.id}`;
    case "customers": return route.filter ? `#/customers?filter=${encodeURIComponent(route.filter)}` : "#/customers";
    case "customer": return `#/customers/${route.id}`;
    case "parts": return "#/parts";
    case "chat": return "#/chat";
    case "settings": return route.section ? `#/settings/${route.section}` : "#/settings";
  }
}

export function navigate(route: Route) {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}
