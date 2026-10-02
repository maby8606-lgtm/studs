'use client';

import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import api from '../../lib/axios';
import { Package, Clock, Wallet, LogOut, Plus } from 'lucide-react';

interface Order {
  id: string;
  status: string;
  totalGHS: number;
  pickupLocation: string;
  deliveryLocation: string;
  createdAt: string;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }

    const fetchOrders = async () => {
      try {
        const res = await api.get('/orders/my-orders');
        setOrders(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [user]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DELIVERED': return 'bg-green-100 text-green-700';
      case 'PICKED_UP': return 'bg-blue-100 text-blue-700';
      case 'ASSIGNED': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-600 rounded-2xl flex items-center justify-center text-white font-bold">S</div>
            <h1 className="text-2xl font-bold text-green-600">STUDS</h1>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="font-medium">{user?.name}</p>
              <p className="text-sm text-gray-500 capitalize">{user?.role.toLowerCase()}</p>
            </div>
            <button
              onClick={logout}
              className="p-3 hover:bg-gray-100 rounded-xl transition"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold">Dashboard</h2>
          <button
            onClick={() => router.push('/order')}
            className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-2xl hover:bg-green-700 transition"
          >
            <Plus size={20} /> New Order
          </button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="card">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center">
                <Package className="text-green-600" size={28} />
              </div>
              <div>
                <p className="text-sm text-gray-500">Active Orders</p>
                <p className="text-3xl font-semibold">{orders.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
                <Clock className="text-blue-600" size={28} />
              </div>
              <div>
                <p className="text-sm text-gray-500">Recent Activity</p>
                <p className="text-3xl font-semibold">{orders.length}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center">
                <Wallet className="text-purple-600" size={28} />
              </div>
              <div>
                <p className="text-sm text-gray-500">Wallet</p>
                <p className="text-3xl font-semibold">GHS 0.00</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Orders */}
        <div className="card">
          <h3 className="font-semibold text-xl mb-6">Recent Orders</h3>
          
          {loading ? (
            <p>Loading orders...</p>
          ) : orders.length === 0 ? (
            <p className="text-gray-500 py-8 text-center">No orders yet. Place your first order!</p>
          ) : (
            <div className="space-y-4">
              {orders.slice(0, 5).map(order => (
                <div key={order.id} className="flex items-center justify-between p-4 border rounded-2xl hover:bg-gray-50">
                  <div>
                    <p className="font-medium">{order.pickupLocation} → {order.deliveryLocation}</p>
                    <p className="text-sm text-gray-500">GHS {order.totalGHS}</p>
                  </div>
                  <div className={`px-4 py-1 rounded-full text-sm font-medium ${getStatusColor(order.status)}`}>
                    {order.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}