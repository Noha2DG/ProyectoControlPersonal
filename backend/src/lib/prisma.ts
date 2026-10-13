import { PrismaClient } from "@prisma/client";

// Prisma dimensiona el pool como CPUs*2+1: en kronos (1 vCPU) son 3 conexiones para toda la planta,
// y una transacción de Descongelado retiene una hasta 30 s. MariaDB acepta 1000 y el pico medido fue
// 22, así que hay margen de sobra. Si el DATABASE_URL ya trae sus propios valores, mandan esos.
function urlConPool(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const u = new URL(url);
  if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", process.env.DB_POOL_LIMIT || "10");
  if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
  return u.toString();
}

const url = urlConPool();
const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

export default prisma;
