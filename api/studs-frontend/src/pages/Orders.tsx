import { useState, useEffect } from 'react';
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

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      const res = await api.get('/orders/my-orders');
      setOrders(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DELIVERED': return '#10b981';
      case 'PICKED_UP': return '#f472b6';
      case 'ASSIGNED': return '#fbbf24';
      case 'CANCELLED': return '#ef4444';
      default: return '#64748b';
    }
  };

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: '60px 40px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '60px' }}>
            <div>
              <h1 style={{ fontSize: '56px', fontWeight: '800', letterSpacing: '-1.5px' }}>My Orders</h1>
              <p style={{ color: '#f472b6', fontSize: '20px' }}>Track your deliveries in real-time</p>
            </div>
            <button
              onClick={loadOrders}
              style={{
                padding: '16px 36px',
                background: '#1a1a2e',
                border: 'none',
                borderRadius: '9999px',
                fontWeight: '600',
                fontSize: '17px',
                color: '#f8fafc'
              }}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p style={{ textAlign: 'center', fontSize: '22px', color: '#e0e7ff' }}>Loading your orders...</p>
          ) : orders.length === 0 ? (
            <div style={{
              background: '#1a1a2e',
              padding: '120px 40px',
              borderRadius: '32px',
              textAlign: 'center',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
            }}>
              <h3 style={{ fontSize: '28px' }}>No orders yet</h3>
              <p style={{ color: '#e0e7ff', marginTop: '20px' }}>Go to the menu and place your first order!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {orders.map((order: any) => (
                <div
                  key={order.id}
                  style={{
                    background: '#1a1a2e',
                    padding: '40px',
                    borderRadius: '32px',
                    borderLeft: `8px solid ${getStatusColor(order.status)}`,
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '28px' }}>
                    <div>
                      <p style={{
                        fontSize: '26px',
                        fontWeight: '700',
                        color: '#f8fafc'
                      }}>
                        Order #{order.id.slice(0, 8).toUpperCase()}
                      </p>
                      <p style={{ color: '#e0e7ff', marginTop: '8px' }}>
                        {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '32px', fontWeight: '700' }}>GHS {order.total}</p>
                      <p style={{
                        color: getStatusColor(order.status),
                        fontWeight: '700',
                        marginTop: '8px',
                        fontSize: '18px'
                      }}>
                        {order.status}
                      </p>
                    </div>
                  </div>

                  {order.qrCode && (
                    <div style={{ margin: '32px 0', textAlign: 'center', padding: '20px', background: '#0f0f1f', borderRadius: '20px' }}>
                      <p style={{ marginBottom: '16px', color: '#e0e7ff' }}>Show this QR Code to the Rider</p>
                      <img
                        src={order.qrCode}
                        alt="QR Code"
                        style={{
                          width: '200px',
                          borderRadius: '16px',
                          background: 'white',
                          padding: '16px'
                        }}
                      />
                    </div>
                  )}

                  <div style={{ marginTop: '20px', color: '#e0e7ff', fontSize: '17px' }}>
                    <strong>Delivery Location:</strong> {order.deliveryLocation || 'Your Location'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}