import { isAttendanceMinutesOpen } from '../../backend/src/services/attendancePolicy';

const TIMEZONE = "America/Lima";

export function getPeruNow() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("es-PE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;

  const hr = get("hour") || "00";
  const min = get("minute") || "00";

  return {
    day: get("day") || "",
    month: get("month") || "",
    year: get("year") || "",
    hour: hr,
    minute: min,
    second: get("second") || "",
    formatted: `${get("day")}/${get("month")}/${get("year")} ${hr}:${min}`,
    currentMinutes: Number(hr) * 60 + Number(min),
  };
}

export function isAttendanceWindowOpen(userRole: string, hasApprovedReopen = false, currentMinutes = getPeruNow().currentMinutes) {
  if (userRole === "Administrador") return true;

  if (hasApprovedReopen) return true;

  return isAttendanceMinutesOpen(currentMinutes);
}

export function formatPeruDate(date: Date) {
  // Return formatted string for log entries
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const day = String(tzDate.getDate()).padStart(2, '0');
  const month = String(tzDate.getMonth() + 1).padStart(2, '0');
  const year = tzDate.getFullYear();
  const hours = String(tzDate.getHours()).padStart(2, '0');
  const minutes = String(tzDate.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}
