import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';

const api = axios.create({
  baseURL: 'http://localhost:3001',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [allOrders, setAllOrders] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [riderShifts, setRiderShifts] = useState([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [fraudFlags, setFraudFlags] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'ADMIN') navigate('/dashboard');
    else loadData();
  }, [navigate]);

  const loadData = async () => {
    try {
      const [ordersRes, disputesRes, shiftsRes, withdrawalsRes, flagsRes] = await Promise.all([
        api.get('/orders/admin/all-orders'),
        api.get('/orders/admin/all-disputes'),
        api.get('/orders/admin/rider-shifts'),
        api.get('/wallet/admin/withdrawals'),
        api.get('/admin/fraud-flags?status=OPEN'),
      ]);
      setAllOrders(ordersRes.data || []);
      setDisputes(disputesRes.data || []);
      setRiderShifts(shiftsRes.data || []);
      setWithdrawals(withdrawalsRes.data || []);
      setFraudFlags(flagsRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resolveDispute = async (orderId: string, status: 'RESOLVED' | 'REFUNDED') => {
    try {
      await api.patch(`/orders/${orderId}/resolve`, { status });
      alert(`Dispute ${status.toLowerCase()}!`);
      loadData();
    } catch (err) {
      alert('Failed to resolve');
    }
  };

  const reviewWithdrawal = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    if (status === 'REJECTED' && !confirm('Reject this withdrawal? The reserved balance is released back to the user.')) return;
    setBusyId(id);
    try {
      await api.patch(`/wallet/admin/withdrawals/${id}`, { status });
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Review failed');
    } finally { setBusyId(null); }
  };

  const retryWithdrawal = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/wallet/admin/withdrawals/${id}/retry`);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Retry failed');
    } finally { setBusyId(null); }
  };

  const reconcileWithdrawal = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/wallet/admin/withdrawals/${id}/reconcile`);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Reconcile failed');
    } finally { setBusyId(null); }
  };

  const resolveFlag = async (id: string) => {
    setBusyId(id);
    try {
      await api.patch(`/admin/fraud-flags/${id}/resolve`);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Could not resolve flag');
    } finally { setBusyId(null); }
  };

  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'PENDING');
  const sentWithdrawals = withdrawals.filter((w) => w.status === 'APPROVED' || w.status === 'FAILED').slice(0, 10);

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: 'clamp(32px, 7vw, 80px) clamp(16px, 4vw, 40px)' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h1 style={{ fontSize: 'clamp(34px, 8vw, 58px)', fontWeight: '900', letterSpacing: '-2px' }}>Admin Control Center</h1>
          <p style={{ color: '#f472b6', fontSize: '24px' }}>System Overview</p>

          {loading ? (
            <p style={{ textAlign: 'center', fontSize: '22px', color: '#e0e7ff' }}>Loading admin data...</p>
          ) : (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: '40px', marginTop: '60px' }}>
              {/* All Orders */}
              <div>
                <h2 style={{ fontSize: '32px', marginBottom: '30px', color: '#f472b6' }}>All Orders ({allOrders.length})</h2>
                <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                  {allOrders.map((order: any) => (
                    <div key={order.id} style={{ background: '#1a1a2e', padding: '24px', borderRadius: '20px', marginBottom: '16px' }}>
                      <p><strong>Order #{order.id.slice(0,8)}</strong> • {order.status}</p>
                      <p>Student: {order.studentId} | Rider: {order.assignedRiderId}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Disputes */}
              <div>
                <h2 style={{ fontSize: '32px', marginBottom: '30px', color: '#f87171' }}>Active Disputes ({disputes.length})</h2>
                {disputes.length === 0 ? (
                  <div style={{ background: '#1a1a2e', padding: '80px', borderRadius: '28px', textAlign: 'center' }}>
                    <p style={{ fontSize: '22px' }}>No disputes</p>
                  </div>
                ) : (
                  disputes.map((order: any) => (
                    <div key={order.id} style={{ background: '#1a1a2e', padding: '24px', borderRadius: '20px', marginBottom: '16px' }}>
                      <p>Order #{order.id.slice(0,8)}</p>
                      <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                        <button onClick={() => resolveDispute(order.id, 'RESOLVED')} style={{ flex: 1, padding: '14px', background: '#10b981', border: 'none', borderRadius: '999px' }}>Resolve</button>
                        <button onClick={() => resolveDispute(order.id, 'REFUNDED')} style={{ flex: 1, padding: '14px', background: '#ef4444', border: 'none', borderRadius: '999px' }}>Refund</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Withdrawal reviews */}
            <div style={{ marginTop: '60px' }}>
              <h2 style={{ fontSize: '32px', marginBottom: '30px', color: '#10b981' }}>Withdrawal Reviews ({pendingWithdrawals.length} pending)</h2>
              {pendingWithdrawals.length === 0 && sentWithdrawals.length === 0 ? (
                <div style={{ background: '#1a1a2e', padding: '60px', borderRadius: '28px', textAlign: 'center' }}>
                  <p style={{ fontSize: '22px' }}>No withdrawals to review</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '700px', overflowY: 'auto' }}>
                  {pendingWithdrawals.map((w: any) => (
                    <div key={w.id} style={{ background: '#1a1a2e', padding: '24px', borderRadius: '20px', borderLeft: '8px solid #fbbf24', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                      <div>
                        <p style={{ fontSize: '20px' }}><strong>GHS {Number(w.amount).toFixed(2)}</strong> → {w.momoNumber} ({w.network || 'MTN'})</p>
                        <p style={{ color: '#94a3b8', marginTop: '4px' }}>User {w.userId.slice(0, 8)}… · {new Date(w.createdAt).toLocaleString()}</p>
                      </div>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button onClick={() => reviewWithdrawal(w.id, 'APPROVED')} disabled={busyId === w.id}
                          style={{ padding: '14px 28px', background: '#10b981', border: 'none', borderRadius: '999px', fontWeight: '700', color: 'white', cursor: 'pointer', opacity: busyId === w.id ? 0.6 : 1 }}>
                          {busyId === w.id ? 'Working…' : 'Approve & Send'}
                        </button>
                        <button onClick={() => reviewWithdrawal(w.id, 'REJECTED')} disabled={busyId === w.id}
                          style={{ padding: '14px 28px', background: '#ef4444', border: 'none', borderRadius: '999px', fontWeight: '700', color: 'white', cursor: 'pointer', opacity: busyId === w.id ? 0.6 : 1 }}>
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                  {sentWithdrawals.map((w: any) => (
                    <div key={w.id} style={{ background: '#1a1a2e', padding: '24px', borderRadius: '20px', borderLeft: `8px solid ${w.status === 'FAILED' ? '#ef4444' : '#38bdf8'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                      <div>
                        <p style={{ fontSize: '20px' }}><strong>GHS {Number(w.amount).toFixed(2)}</strong> → {w.momoNumber} · <span style={{ color: w.status === 'FAILED' ? '#ef4444' : '#38bdf8', fontWeight: 700 }}>{w.status}</span></p>
                        <p style={{ color: '#94a3b8', marginTop: '4px' }}>
                          Transfer: {w.transferStatus}{w.failureReason ? ` · ${w.failureReason}` : ''} · {new Date(w.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button onClick={() => retryWithdrawal(w.id)} disabled={busyId === w.id}
                          style={{ padding: '12px 24px', background: '#f59e0b', border: 'none', borderRadius: '999px', fontWeight: '700', color: '#05060f', cursor: 'pointer', opacity: busyId === w.id ? 0.6 : 1 }}>
                          {busyId === w.id ? 'Working…' : 'Retry transfer'}
                        </button>
                        <button onClick={() => reconcileWithdrawal(w.id)} disabled={busyId === w.id}
                          style={{ padding: '12px 24px', background: '#334155', border: 'none', borderRadius: '999px', fontWeight: '700', color: 'white', cursor: 'pointer', opacity: busyId === w.id ? 0.6 : 1 }}>
                          Reconcile
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Fraud flags */}
            <div style={{ marginTop: '60px' }}>
              <h2 style={{ fontSize: '32px', marginBottom: '30px', color: '#fb7185' }}>🚩 Fraud Flags ({fraudFlags.length} open)</h2>
              {fraudFlags.length === 0 ? (
                <div style={{ background: '#1a1a2e', padding: '60px', borderRadius: '28px', textAlign: 'center' }}>
                  <p style={{ fontSize: '22px' }}>No open flags — all clear</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '600px', overflowY: 'auto' }}>
                  {fraudFlags.map((f: any) => {
                    const sevColor = f.severity === 'HIGH' ? '#ef4444' : f.severity === 'MEDIUM' ? '#fbbf24' : '#38bdf8';
                    return (
                      <div key={f.id} style={{ background: '#1a1a2e', padding: '24px', borderRadius: '20px', borderLeft: `8px solid ${sevColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                        <div>
                          <p style={{ fontSize: '19px' }}>
                            <strong>{f.type.replaceAll('_', ' ')}</strong>
                            <span style={{ marginLeft: '12px', padding: '4px 14px', borderRadius: '999px', background: `${sevColor}22`, border: `1px solid ${sevColor}`, color: sevColor, fontSize: '13px', fontWeight: 700 }}>{f.severity}</span>
                          </p>
                          <p style={{ color: '#e0e7ff', marginTop: '6px' }}>{f.detail}</p>
                          <p style={{ color: '#94a3b8', marginTop: '4px', fontSize: '14px' }}>
                            User {f.userId ? `${f.userId.slice(0, 8)}…` : '—'}{f.orderId ? ` · Order ${f.orderId.slice(0, 8)}…` : ''} · {new Date(f.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <button onClick={() => resolveFlag(f.id)} disabled={busyId === f.id}
                          style={{ padding: '12px 28px', background: '#10b981', border: 'none', borderRadius: '999px', fontWeight: '700', color: 'white', cursor: 'pointer', opacity: busyId === f.id ? 0.6 : 1 }}>
                          {busyId === f.id ? 'Working…' : 'Mark reviewed'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: '60px' }}>
              <h2 style={{ fontSize: '32px', marginBottom: '30px', color: '#60a5fa' }}>Rider Shifts ({riderShifts.length})</h2>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {riderShifts.length === 0 ? (
                  <div style={{ background: '#1a1a2e', padding: '60px', borderRadius: '28px', textAlign: 'center' }}>
                    <p style={{ fontSize: '22px' }}>No shifts recorded</p>
                  </div>
                ) : (
                  riderShifts.map((shift: any) => (
                    <div key={shift.id} style={{ background: '#1a1a2e', padding: '24px', borderRadius: '20px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p><strong>Rider:</strong> {shift.riderId.slice(0, 8)}…</p>
                        <p style={{ color: '#94a3b8' }}>
                          {new Date(shift.clockInTime).toLocaleString()} → {shift.clockOutTime ? new Date(shift.clockOutTime).toLocaleString() : 'on duty'}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ color: shift.status === 'ON_DUTY' ? '#10b981' : '#94a3b8', fontWeight: '700' }}>{shift.status.replace('_', ' ')}</p>
                        <p style={{ color: '#e0e7ff' }}>{shift.ordersCompleted} deliveries • GHS {Number(shift.totalEarned).toFixed(2)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}