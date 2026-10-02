import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/axios';
import Navbar from '../components/Navbar';
import {
  PageShell, Card, PrimaryButton, GhostButton, TextInput, StatusPill,
  EmptyState, SkeletonCards, OrderTimeline, STATUS_COLORS, type TimelineStep,
} from '../components/ui';
import { idemConfig, newIdemKey } from '../lib/idempotency';

const ACTIVE = ['PENDING', 'ASSIGNED', 'PICKED_UP'];

export default function Orders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [p2p, setP2p] = useState({ pickupLocation: '', deliveryLocation: '', itemDescription: '', recipientPhone: '' });
  const [p2pBusy, setP2pBusy] = useState(false);
  const [p2pMsg, setP2pMsg] = useState('');
  const [p2pKey, setP2pKey] = useState<string>(() => newIdemKey());
  // P2P zone pricing: pickup + delivery zones price the trip by distance.
  const [p2pZones, setP2pZones] = useState<any[]>([]);
  const [p2pBandFees, setP2pBandFees] = useState<number[]>([5, 8, 12]);
  const [p2pPickupZone, setP2pPickupZone] = useState('');
  const [p2pDeliveryZone, setP2pDeliveryZone] = useState('');
  const p2pFee = (() => {
    const a = p2pZones.find((z) => z.id === p2pPickupZone);
    const b = p2pZones.find((z) => z.id === p2pDeliveryZone);
    if (!a || !b) return null;
    return p2pBandFees[Math.min(Math.abs(a.band - b.band), 2)];
  })();
  const [timelines, setTimelines] = useState<Record<string, TimelineStep[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const campusId = user.campusId || 'ug-legon';

  const loadTimeline = useCallback(async (orderId: string) => {
    try {
      const res = await api.get(`/orders/${orderId}/timeline`);
      setTimelines((t) => ({ ...t, [orderId]: res.data.steps || [] }));
    } catch { /* timeline is best-effort decoration */ }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await api.get('/orders/my-orders');
      const list = res.data || [];
      setOrders(list);
      // Eagerly track every in-flight order.
      list.filter((o: any) => ACTIVE.includes(o.status)).forEach((o: any) => loadTimeline(o.id));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [loadTimeline]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/orders/delivery-zones?campusId=${campusId}`);
        setP2pZones(res.data.zones || []);
        if (res.data.bandFeesGHS) setP2pBandFees(res.data.bandFeesGHS);
        if (res.data.zones?.length) {
          setP2pPickupZone((z) => z || res.data.zones[0].id);
          setP2pDeliveryZone((z) => z || res.data.zones[0].id);
        }
      } catch { /* legacy flat fee path */ }
    })();
  }, [campusId]);

  // Live tracking: refresh while anything is still moving.
  useEffect(() => {
    const hasActive = orders.some((o) => ACTIVE.includes(o.status));
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (hasActive) {
      refreshTimer.current = setInterval(loadOrders, 15000);
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [orders, loadOrders]);

  const sendPackage = async () => {
    setP2pBusy(true);
    setP2pMsg('');
    try {
      const payload: any = { campusId, ...p2p };
      // Zone-priced when both ends are known; legacy flat fee otherwise.
      if (p2pPickupZone && p2pDeliveryZone) {
        payload.pickupZone = p2pPickupZone;
        payload.deliveryZone = p2pDeliveryZone;
      }
      const res = await api.post('/orders/p2p', payload, idemConfig(p2pKey));
      setP2pMsg(res.data.deliveryFeeWaived
        ? '✅ Package booked — delivery fee covered by STUDS Plus! Show your QR code to the rider at pickup.'
        : `✅ Package booked — GHS ${Number(res.data.totalGHS).toFixed(2)} (incl. GHS ${Number(res.data.deliveryFeeGHS).toFixed(2)} delivery) taken from your wallet. Show your QR code to the rider at pickup.`);
      setP2p({ pickupLocation: '', deliveryLocation: '', itemDescription: '', recipientPhone: '' });
      setP2pKey(newIdemKey());
      loadOrders();
    } catch (err: any) {
      setP2pMsg(err?.response?.data?.message || 'Could not book the package delivery');
    } finally { setP2pBusy(false); }
  };

  const requestSmsCode = async (orderId: string) => {
    try {
      const res = await api.post(`/orders/${orderId}/sms-code`);
      alert(`📩 Confirmation code sent to ${res.data.sentTo}. Give it to the rider at delivery.`);
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Could not send the code');
    }
  };

  const cancelOrder = async (orderId: string) => {
    if (!confirm('Cancel this order and get a full refund?')) return;
    try {
      await api.post(`/orders/${orderId}/cancel`);
      loadOrders();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Could not cancel');
    }
  };

  return (
    <>
      <Navbar />
      <PageShell
        title="My Orders"
        subtitle="Track your deliveries live"
        actions={<GhostButton onClick={loadOrders}>↻ Refresh</GhostButton>}
      >
        {/* Send a Package (P2P) */}
        {user.role === 'STUDENT' && (
          <Card style={{ marginBottom: '48px', border: '1px solid rgba(244, 114, 182, 0.3)' }}>
            <h2 style={{ fontSize: '28px', fontWeight: 800 }}>📦 Send a Package</h2>
            <p style={{ color: '#94a3b8', marginTop: '8px' }}>
              Campus-to-campus courier — priced by distance, from GHS 5.00 (free with STUDS Plus). A rider is assigned immediately.
            </p>
            {p2pZones.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: '16px', marginTop: '16px' }}>
                <label style={{ fontSize: '14px', color: '#94a3b8' }}>
                  Pickup zone
                  <select value={p2pPickupZone} onChange={(e) => setP2pPickupZone(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: '6px', padding: '14px', borderRadius: '12px', background: '#1a1a2e', color: '#f8fafc', border: '1px solid #475569' }}>
                    {p2pZones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '14px', color: '#94a3b8' }}>
                  Delivery zone
                  <select value={p2pDeliveryZone} onChange={(e) => setP2pDeliveryZone(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: '6px', padding: '14px', borderRadius: '12px', background: '#1a1a2e', color: '#f8fafc', border: '1px solid #475569' }}>
                    {p2pZones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </label>
              </div>
            )}
            {p2pFee !== null && (
              <p style={{ color: '#f472b6', fontWeight: 700, marginTop: '12px' }}>
                Delivery fee for this trip: GHS {p2pFee.toFixed(2)}
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: '16px', marginTop: '24px' }}>
              <TextInput placeholder="Pickup location (e.g. Balme Library)" value={p2p.pickupLocation}
                onChange={(v) => setP2p({ ...p2p, pickupLocation: v })} />
              <TextInput placeholder="Delivery location (e.g. Jean Nelson Hall)" value={p2p.deliveryLocation}
                onChange={(v) => setP2p({ ...p2p, deliveryLocation: v })} />
              <TextInput placeholder="What are you sending?" value={p2p.itemDescription}
                onChange={(v) => setP2p({ ...p2p, itemDescription: v })} />
              <TextInput placeholder="Recipient phone (optional)" value={p2p.recipientPhone}
                onChange={(v) => setP2p({ ...p2p, recipientPhone: v.replace(/[^0-9]/g, '').slice(0, 10) })} />
            </div>
            <PrimaryButton onClick={sendPackage} disabled={p2pBusy || !p2p.pickupLocation || !p2p.deliveryLocation || !p2p.itemDescription} style={{ marginTop: '24px' }}>
              {p2pBusy ? 'Booking…' : 'Send Package'}
            </PrimaryButton>
            {p2pMsg && <p style={{ marginTop: '16px', color: '#fbbf24' }}>{p2pMsg}</p>}
          </Card>
        )}

        {loading ? (
          <SkeletonCards count={2} />
        ) : orders.length === 0 ? (
          <EmptyState title="No orders yet" body="Head to the menu and place your first order — or send a package above." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            {orders.map((order: any) => {
              const showTimeline = !!expanded[order.id] || ACTIVE.includes(order.status);
              return (
                <Card key={order.id} accent={STATUS_COLORS[order.status] || '#64748b'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                      <p style={{ fontSize: '24px', fontWeight: 700 }}>
                        {order.orderType === 'P2P' ? '📦 Package' : '🍽️ Order'} #{order.id.slice(0, 8).toUpperCase()}
                      </p>
                      <p style={{ color: '#e0e7ff', marginTop: '6px' }}>{new Date(order.createdAt).toLocaleString()}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '30px', fontWeight: 800 }}>GHS {Number(order.total).toFixed(2)}</p>
                      <div style={{ marginTop: '8px' }}><StatusPill status={order.status} /></div>
                    </div>
                  </div>

                  <div style={{ marginTop: '18px', color: '#e0e7ff', fontSize: '16px', lineHeight: 1.7 }}>
                    <div><strong>From:</strong> {order.pickupLocation || 'Vendor'}</div>
                    <div><strong>To:</strong> {order.deliveryLocation || 'Your Location'}</div>
                    {order.orderType === 'P2P' && (
                      <div>
                        📦 {order.itemDescription || 'Package'}
                        {order.deliveryFeeWaived && <span style={{ color: '#10b981', fontWeight: 700 }}> · fee covered by STUDS Plus</span>}
                      </div>
                    )}
                    {Array.isArray(order.orderItems) && order.orderItems.length > 0 && (
                      <div>🧾 {order.orderItems.map((i: any) => `${i.quantity}× ${i.menuItem?.name || 'item'}`).join(', ')}</div>
                    )}
                  </div>

                  {order.qrCode && order.status !== 'DELIVERED' && (
                    <div style={{ margin: '24px 0 4px', textAlign: 'center', padding: '20px', background: '#0f0f1f', borderRadius: '20px' }}>
                      <p style={{ marginBottom: '14px', color: '#e0e7ff' }}>Show this QR code to the rider</p>
                      <img src={order.qrCode} alt="QR Code" style={{ width: '190px', borderRadius: '16px', background: 'white', padding: '14px' }} />
                    </div>
                  )}

                  {/* Tracking timeline */}
                  {timelines[order.id] && (
                    <div style={{ marginTop: '24px', background: '#0f0f1f', borderRadius: '20px', padding: '24px 26px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <p style={{ fontWeight: 800, fontSize: '17px' }}>🚚 Delivery tracking</p>
                        {!ACTIVE.includes(order.status) && (
                          <GhostButton onClick={() => setExpanded((e) => ({ ...e, [order.id]: !e[order.id] }))} style={{ padding: '8px 18px', fontSize: '13px' }}>
                            {expanded[order.id] ? 'Hide' : 'Show'}
                          </GhostButton>
                        )}
                      </div>
                      {showTimeline && <OrderTimeline steps={timelines[order.id]} />}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '22px' }}>
                    {order.status === 'PICKED_UP' && (
                      <GhostButton onClick={() => requestSmsCode(order.id)} style={{ background: '#38bdf8', color: '#05060f' }}>
                        📩 Send me an SMS confirmation code
                      </GhostButton>
                    )}
                    {(order.status === 'ASSIGNED' || order.status === 'PENDING') && (
                      <GhostButton danger onClick={() => cancelOrder(order.id)}>
                        Cancel (full refund)
                      </GhostButton>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageShell>
    </>
  );
}
