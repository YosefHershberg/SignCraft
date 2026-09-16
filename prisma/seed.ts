import { PrismaClient, type OrderStatus, type SignType } from '@prisma/client';

const prisma = new PrismaClient();

const VENDORS = ['Acme Signs', 'Brightline Fab', 'Metro Signworks'];
const INSTALLERS = ['Dana K.', 'Omar S.', 'Priya N.', 'Luis M.'];
const DAY = 86_400_000;

type SeedOrder = {
  n: number;
  title: string;
  customer: string;
  signType: SignType;
  w: number;
  h: number;
  qty: number;
  address: string;
  dueIn: number;
  vendor: string;
  status: OrderStatus;
  notes?: string;
};

const ORDERS: SeedOrder[] = [
  { n: 1, title: 'Fascia sign', customer: 'Riverside Bakery', signType: 'STOREFRONT', w: 320, h: 60, qty: 1, address: '12 River St, Leeds', dueIn: 10, vendor: 'Acme Signs', status: 'SUBMITTED' },
  { n: 2, title: 'Window decal set', customer: 'Cedar & Co', signType: 'STOREFRONT', w: 120, h: 80, qty: 4, address: '4 Cedar Row, York', dueIn: 8, vendor: 'Brightline Fab', status: 'DRAFT' },
  { n: 3, title: 'Monument base', customer: 'Northwind Dental', signType: 'MONUMENT', w: 180, h: 120, qty: 1, address: '88 Harbour Rd, Hull', dueIn: 21, vendor: 'Metro Signworks', status: 'DRAFT' },
  { n: 4, title: 'Pylon refacing', customer: 'Grove Market', signType: 'WAYFINDING', w: 90, h: 240, qty: 2, address: '1 Grove Sq, Sheffield', dueIn: 14, vendor: 'Acme Signs', status: 'VENDOR_ACCEPTED' },
  { n: 5, title: 'Lobby letters', customer: 'Halcyon Hotel', signType: 'STOREFRONT', w: 200, h: 40, qty: 1, address: '30 Park Ln, Leeds', dueIn: 12, vendor: 'Brightline Fab', status: 'VENDOR_ACCEPTED' },
  { n: 6, title: 'Directory panel', customer: 'Lakeshore Clinic', signType: 'WAYFINDING', w: 60, h: 150, qty: 3, address: '7 Lake Dr, Bradford', dueIn: 6, vendor: 'Metro Signworks', status: 'IN_PRODUCTION' },
  { n: 7, title: 'Blade sign', customer: "Otto's Garage", signType: 'BANNER', w: 50, h: 100, qty: 1, address: '19 Otto St, Wakefield', dueIn: 5, vendor: 'Acme Signs', status: 'READY_FOR_INSTALL' },
  { n: 8, title: 'Van wrap', customer: 'Peak Couriers', signType: 'VEHICLE_WRAP', w: 500, h: 200, qty: 2, address: '2 Summit Way, Leeds', dueIn: 3, vendor: 'Brightline Fab', status: 'COMPLETED' },
];

const CHAIN: OrderStatus[] = ['DRAFT', 'SUBMITTED', 'VENDOR_ACCEPTED', 'IN_PRODUCTION', 'READY_FOR_INSTALL', 'COMPLETED'];

export async function seed() {
  const vendors = new Map<string, string>();
  for (const name of VENDORS) {
    vendors.set(name, (await prisma.vendor.upsert({ where: { name }, update: {}, create: { name } })).id);
  }
  const installers = new Map<string, string>();
  for (const name of INSTALLERS) {
    installers.set(name, (await prisma.installer.upsert({ where: { name }, update: {}, create: { name } })).id);
  }
  const now = Date.now();
  for (const o of ORDERS) {
    const orderNumber = `SC-${String(o.n).padStart(4, '0')}`;
    if (await prisma.order.findUnique({ where: { orderNumber } })) continue;
    const idx = CHAIN.indexOf(o.status);
    const history = CHAIN.slice(0, idx + 1).map((to, i) => ({
      from: i === 0 ? null : CHAIN[i - 1],
      to,
      actorType: i === 0 ? 'SYSTEM' : i === 1 ? 'OPS' : i === 5 ? 'INSTALLER' : 'VENDOR',
      actorId: null,
      reason: null,
      at: new Date(now - (idx - i + 1) * 3_600_000),
    })) as { from: OrderStatus | null; to: OrderStatus; actorType: 'OPS' | 'VENDOR' | 'INSTALLER' | 'SYSTEM'; actorId: null; reason: null; at: Date }[];
    const order = await prisma.order.create({
      data: {
        orderNumber,
        title: o.title,
        customerName: o.customer,
        signType: o.signType,
        widthCm: o.w,
        heightCm: o.h,
        quantity: o.qty,
        installAddress: o.address,
        dueDate: new Date(now + o.dueIn * DAY),
        notes: o.notes ?? null,
        vendorId: vendors.get(o.vendor)!,
        status: o.status,
        version: idx,
        history,
      },
    });
    if (idx >= 1) {
      await prisma.asset.create({
        data: {
          orderId: order.id,
          fileName: `${orderNumber.toLowerCase()}-print.pdf`,
          contentType: 'application/pdf',
          sizeBytes: BigInt(4_200_000 + o.n * 10_000),
          storageKey: `orders/${order.id}/seed/${orderNumber.toLowerCase()}-print.pdf`,
          status: 'UPLOADED',
          bytesUploaded: BigInt(4_200_000 + o.n * 10_000),
          progressPct: 100,
        },
      });
    }
    if (o.status === 'READY_FOR_INSTALL') {
      await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });
    }
    if (o.status === 'COMPLETED') {
      await prisma.installJob.create({ data: { orderId: order.id, status: 'ASSIGNED', installerId: installers.get('Dana K.')! } });
    }
  }
  // one DRAFT with an uploaded asset (SC-0002) so Submit is demonstrable immediately
  const draft = await prisma.order.findUnique({ where: { orderNumber: 'SC-0002' } });
  if (draft && !(await prisma.asset.findFirst({ where: { orderId: draft.id } }))) {
    await prisma.asset.create({
      data: {
        orderId: draft.id,
        fileName: 'print_v3.pdf',
        contentType: 'application/pdf',
        sizeBytes: BigInt(12_600_000),
        storageKey: `orders/${draft.id}/seed/print_v3.pdf`,
        status: 'UPLOADED',
        bytesUploaded: BigInt(12_600_000),
        progressPct: 100,
      },
    });
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
