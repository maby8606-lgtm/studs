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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'ADMIN') navigate('/dashboard');
    else loadData();
  }, [navigate]);

  const loadData = async () => {
    try {
      const [ordersRes, disputesRes, shiftsRes] = await Promise.all([
        api.get('/orders/admin/all-orders'),
        api.get('/orders/admin/all-disputes'),
        api.get('/orders/admin/rider-shifts')
      ]);
      setAllOrders(ordersRes.data || []);
      setDisputes(disputesRes.data || []);
      setRiderShifts(shiftsRes.data || []);
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

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '58px', fontWeight: '900', letterSpacing: '-2px' }}>Admin Control Center</h1>
          <p style={{ color: '#f472b6', fontSize: '24px' }}>System Overview</p>

          {loading ? (
            <p style={{ textAlign: 'center', fontSize: '22px', color: '#e0e7ff' }}>Loading admin data...</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', marginTop: '60px' }}>
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
          )}
        </div>
      </div>
    </>
  );
}