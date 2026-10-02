import { useState, useEffect, useRef } from 'react';
import api from '../lib/axios';
import Navbar from '../components/Navbar';
import { idemConfig } from '../lib/idempotency';

type AttemptStatus = 'PENDING' | 'INITIATED' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

const REASON_LABELS: Record<string, string> = {
  TOPUP: '💳 MoMo top-up',
  WITHDRAWAL: '🏧 Withdrawal',
  WITHDRAWAL_REVERSAL: '↩️ Withdrawal returned',
  ORDER_PAYMENT: '🧾 Order payment',
  ORDER_REFUND: '↩️ Order refund',
  VENDOR_PAYOUT: '🏪 Vendor payout',
  RIDER_PAYOUT: '🚲 Rider payout',
  PLATFORM_COMMISSION: '🏦 Platform commission',
  SUBSCRIPTION_PAYMENT: '⭐ Subscription',
  SUBSCRIPTION_REFUND: '↩️ Subscription refund',
};

export default function Wallet() {
  const [balance, setBalance] = useState(0);
  const [available, setAvailable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [momoNumber, setMomoNumber] = useState('');
  const [network, setNetwork] = useState('MTN');
  const [pendingAttempt, setPendingAttempt] = useState<string | null>(null);
  const [attemptMessage, setAttemptMessage] = useState('');
  const [needsOtp, setNeedsOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [submittingOtp, setSubmittingOtp] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [mySub, setMySub] = useState<any>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    loadWallet();
    loadSubscription();
    loadTransactions();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const loadSubscription = async () => {
    try {
      const [p, m] = await Promise.all([api.get('/subscriptions/plans'), api.get('/subscriptions/me')]);
      setPlans(p.data || []);
      setMySub(m.data || null);
    } catch { /* subscriptions are optional */ }
  };

  const loadTransactions = async () => {
    try {
      const res = await api.get('/wallet/transactions');
      setTransactions(res.data || []);
    } catch { /* history is decoration */ }
  };

  const subscribe = async (planCode: string) => {
    setSubBusy(true);
    try {
      await api.post('/subscriptions/subscribe', { planCode }, idemConfig());
      await loadSubscription();
      loadWallet();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Could not subscribe');
    } finally { setSubBusy(false); }
  };

  const cancelSub = async () => {
    if (!confirm('Cancel your subscription? Benefits run until the period ends, then it expires.')) return;
    setSubBusy(true);
    try {
      await api.post('/subscriptions/cancel');
      await loadSubscription();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Could not cancel');
    } finally { setSubBusy(false); }
  };

  const loadWallet = async () => {
    try {
      const res = await api.get('/wallet');
      setBalance(res.data.balance || 0);
      setAvailable(res.data.available ?? res.data.balance ?? 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const pollAttempt = (attemptId: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    let tries = 0;
    pollTimer.current = setInterval(async () => {
      tries += 1;
      try {
        const res = await api.get(`/wallet/topup/${attemptId}`);
        const status: AttemptStatus = res.data.status;
        if (status === 'SUCCESS') {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPendingAttempt(null);
          setAttemptMessage(`GHS ${res.data.amount.toFixed(2)} credited to your wallet.`);
          loadWallet();
          loadTransactions();
        } else if (status === 'FAILED' || status === 'EXPIRED') {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPendingAttempt(null);
          setAttemptMessage('The MoMo payment did not complete. No money was added.');
        } else if (tries > 100) {
          // ~5 minutes of polling; the webhook may still arrive later.
          if (pollTimer.current) clearInterval(pollTimer.current);
          setAttemptMessage('Still waiting on the provider. Your balance will update automatically once confirmed.');
        }
      } catch {
        /* keep polling; a transient error shouldn't kill the flow */
      }
    }, 3000);
  };

  const addMoney = async (amount: number | string) => {
    const numAmount = parseFloat(amount.toString());
    if (!numAmount || numAmount <= 0) return alert('Please enter a valid amount');
    const phone = momoNumber.replace(/\s+/g, '');
    if (!/^[0-9]{10}$/.test(phone)) return alert('Enter your 10-digit MoMo number');

    setAdding(true);
    setAttemptMessage('');
    setNeedsOtp(false);
    setOtp('');
    try {
      // Starts a direct MoMo charge. Nothing is credited until the provider
      // confirms — the balance updates when the webhook lands.
      const res = await api.post('/wallet/topup', { amount: numAmount, momoNumber: phone, network }, idemConfig());
      const { attemptId, providerStatus, displayNote } = res.data;
      setCustomAmount('');
      setPendingAttempt(attemptId);
      setAttemptMessage(displayNote || 'Approve the MoMo prompt on your phone to complete payment.');
      if (providerStatus === 'send_otp') {
        setNeedsOtp(true);
        setAttemptMessage('Dial *110# for your voucher code, then enter it below.');
      }
      pollAttempt(attemptId);
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to start the MoMo top-up');
    } finally {
      setAdding(false);
    }
  };

  const submitOtp = async () => {
    if (!pendingAttempt || !/^\d{4,8}$/.test(otp.replace(/\s+/g, ''))) {
      return alert('Enter the 4–8 digit voucher code');
    }
    setSubmittingOtp(true);
    try {
      await api.post(`/wallet/topup/${pendingAttempt}/otp`, { otp: otp.replace(/\s+/g, '') });
      setNeedsOtp(false);
      setOtp('');
      setAttemptMessage('Voucher submitted. Waiting for provider confirmation…');
    } catch (err: any) {
      alert(err?.response?.data?.message || 'OTP submission failed');
    } finally {
      setSubmittingOtp(false);
    }
  };

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: '80px 40px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h1 style={{ fontSize: 'clamp(34px, 8vw, 58px)', fontWeight: '900', letterSpacing: '-2px' }}>My Wallet</h1>
          <p style={{ color: '#f472b6', fontSize: '24px' }}>Manage your STUDS balance</p>

          <div style={{
            background: 'linear-gradient(145deg, #1a1a2e, #0f0f1f)',
            padding: 'clamp(40px, 10vw, 100px) clamp(20px, 6vw, 60px)',
            borderRadius: '40px',
            marginTop: '60px',
            textAlign: 'center',
            boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
            border: '1px solid rgba(244, 114, 182, 0.2)'
          }}>
            <p style={{ color: '#e0e7ff', marginBottom: '16px', fontSize: '22px' }}>Available Balance</p>
            <h2 style={{
              fontSize: 'clamp(52px, 15vw, 92px)',
              fontWeight: '900',
              color: '#f472b6',
              margin: '0 0 20px 0',
              letterSpacing: '-3px'
            }}>
              GHS {loading ? '…' : balance.toFixed(2)}
            </h2>
            {!loading && available < balance && (
              <p style={{ color: '#94a3b8', fontSize: '18px' }}>
                GHS {(balance - available).toFixed(2)} reserved for pending withdrawals
              </p>
            )}
          </div>

          {attemptMessage && (
            <div style={{
              marginTop: '40px',
              padding: '24px 32px',
              background: '#1a1a2e',
              border: '1px solid #f472b6',
              borderRadius: '24px',
              fontSize: '20px',
              color: '#e0e7ff'
            }}>
              {pendingAttempt ? '⏳ ' : '💰 '}{attemptMessage}
              {needsOtp && pendingAttempt && (
                <div style={{ display: 'flex', gap: '16px', marginTop: '20px' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Voucher code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '18px 24px',
                      background: '#0f0f1f',
                      border: '1px solid #334155',
                      borderRadius: '16px',
                      color: '#f8fafc',
                      fontSize: '20px'
                    }}
                  />
                  <button
                    onClick={submitOtp}
                    disabled={submittingOtp || !otp}
                    style={{
                      padding: '18px 40px',
                      background: '#f472b6',
                      border: 'none',
                      borderRadius: '16px',
                      fontWeight: '700',
                      fontSize: '18px',
                      color: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    {submittingOtp ? 'Sending…' : 'Submit'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Subscriptions */}
          {(plans.length > 0 || mySub?.current) && (
            <div style={{ marginTop: '60px' }}>
              <h3 style={{ marginBottom: '8px', fontSize: '32px' }}>⭐ Subscriptions</h3>
              <p style={{ color: '#94a3b8', fontSize: '18px', marginBottom: '28px' }}>
                Paid from your wallet. Auto-renews every 30 days; cancel any time — benefits run to the end of the paid period.
              </p>

              {mySub?.current ? (
                <div style={{ background: '#1a1a2e', border: '1px solid #10b981', borderRadius: '24px', padding: '28px 32px', marginBottom: '24px' }}>
                  <p style={{ fontSize: '22px', fontWeight: '800', color: '#10b981' }}>
                    {mySub.current.planCode === 'STUDENT_PLUS' ? 'STUDS Plus' : 'STUDS Vendor Pro'} — {mySub.current.status}
                  </p>
                  <p style={{ color: '#e0e7ff', marginTop: '8px' }}>
                    {mySub.current.status === 'CANCELLED'
                      ? `Ends ${new Date(mySub.current.periodEnd).toLocaleDateString()} (not renewing)`
                      : mySub.current.status === 'PAST_DUE'
                        ? '⚠️ Renewal failed — top up your wallet and we will retry automatically.'
                        : `Renews ${new Date(mySub.current.periodEnd).toLocaleDateString()} · GHS ${Number(mySub.current.priceGHS).toFixed(2)}`}
                  </p>
                  {mySub.freeDeliveries && (
                    <p style={{ color: '#f472b6', marginTop: '8px', fontWeight: '700' }}>
                      🚲 Free deliveries this period: {mySub.freeDeliveries.used} used · {mySub.freeDeliveries.remaining} left
                    </p>
                  )}
                  {mySub.current.planCode === 'VENDOR_PRO' && (
                    <p style={{ color: '#f472b6', marginTop: '8px', fontWeight: '700' }}>💼 Commission: 8% (down from 15%)</p>
                  )}
                  <button onClick={cancelSub} disabled={subBusy}
                    style={{ marginTop: '20px', padding: '16px 36px', background: '#334155', border: 'none', borderRadius: '999px', fontWeight: '700', fontSize: '16px', color: '#f8fafc', cursor: 'pointer' }}>
                    {subBusy ? 'Working…' : 'Cancel subscription'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: '24px' }}>
                  {plans.filter((p) => !user.role || p.audience === user.role).map((p) => (
                    <div key={p.code} style={{ background: '#1a1a2e', border: '2px solid #f472b6', borderRadius: '24px', padding: '28px 32px' }}>
                      <p style={{ fontSize: '24px', fontWeight: '800' }}>{p.name}</p>
                      <p style={{ fontSize: '32px', fontWeight: '900', color: '#f472b6', margin: '10px 0' }}>GHS {p.priceGHS}<span style={{ fontSize: '16px', color: '#94a3b8' }}> / 30 days</span></p>
                      <ul style={{ color: '#e0e7ff', lineHeight: '1.9', paddingLeft: '20px', fontSize: '16px' }}>
                        {(p.benefits || []).map((benefit: string) => <li key={benefit}>{benefit}</li>)}
                      </ul>
                      <button onClick={() => subscribe(p.code)} disabled={subBusy}
                        style={{ marginTop: '20px', width: '100%', padding: '18px', background: '#f472b6', border: 'none', borderRadius: '999px', fontWeight: '700', fontSize: '17px', color: 'white', cursor: 'pointer' }}>
                        {subBusy ? 'Working…' : `Subscribe — GHS ${p.priceGHS} from wallet`}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: '80px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '32px' }}>Add Money</h3>
            <p style={{ color: '#94a3b8', fontSize: '18px', marginBottom: '40px' }}>
              Top up with MTN, Telecel or AirtelTigo MoMo. Your wallet is credited only after the payment is confirmed.
            </p>

            {/* MoMo number + network */}
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '24px' }}>
              <input
                type="tel"
                placeholder="MoMo number (10 digits)"
                value={momoNumber}
                onChange={(e) => setMomoNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                style={{
                  flex: 1,
                  padding: '28px',
                  background: '#1a1a2e',
                  border: '1px solid #334155',
                  borderRadius: '9999px',
                  color: '#f8fafc',
                  fontSize: '22px'
                }}
              />
              <select
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                style={{
                  padding: '28px',
                  background: '#1a1a2e',
                  border: '1px solid #334155',
                  borderRadius: '9999px',
                  color: '#f8fafc',
                  fontSize: '20px'
                }}
              >
                <option value="MTN">MTN</option>
                <option value="VODAFONE">Telecel</option>
                <option value="AIRTEL_TIGO">AirtelTigo</option>
              </select>
            </div>

            {/* Custom Amount */}
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: 'clamp(36px, 8vw, 60px)' }}>
              <input
                type="number"
                placeholder="Enter amount (GHS)"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                style={{
                  flex: 1,
                  padding: '28px',
                  background: '#1a1a2e',
                  border: '1px solid #334155',
                  borderRadius: '9999px',
                  color: '#f8fafc',
                  fontSize: '22px'
                }}
              />
              <button
                onClick={() => addMoney(customAmount)}
                disabled={adding || !customAmount}
                style={{
                  padding: '28px 64px',
                  background: '#f472b6',
                  border: 'none',
                  borderRadius: '9999px',
                  fontWeight: '700',
                  fontSize: '20px',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                {adding ? 'Starting…' : 'Top up'}
              </button>
            </div>

            {/* Quick Top-ups */}
            <h4 style={{ marginBottom: '32px', color: '#e0e7ff' }}>Quick Top-up</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: '20px' }}>
              {[20, 50, 100, 200, 500].map((amount) => (
                <button
                  key={amount}
                  onClick={() => addMoney(amount)}
                  disabled={adding}
                  style={{
                    padding: '32px',
                    background: '#1a1a2e',
                    border: '2px solid #f472b6',
                    borderRadius: '24px',
                    fontSize: '24px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    color: '#f8fafc'
                  }}
                >
                  GHS {amount}
                </button>
              ))}
            </div>
          </div>

          {/* Transaction history */}
          {transactions.length > 0 && (
            <div style={{ marginTop: '80px' }}>
              <h3 style={{ marginBottom: '16px', fontSize: '32px' }}>Recent activity</h3>
              <p style={{ color: '#94a3b8', fontSize: '18px', marginBottom: '32px' }}>
                Every cedi in and out of your wallet — the full ledger.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {transactions.slice(0, 25).map((tx: any) => {
                  const credit = tx.type === 'CREDIT';
                  return (
                    <div key={tx.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
                      background: '#1a1a2e', borderRadius: '20px', padding: '20px 26px',
                      borderLeft: `6px solid ${credit ? '#10b981' : '#f472b6'}`,
                    }}>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: '17px' }}>{REASON_LABELS[tx.reason] || tx.reason}</p>
                        <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                          {new Date(tx.createdAt).toLocaleString()}{tx.note ? ` · ${tx.note}` : ''}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontWeight: 800, fontSize: '19px', color: credit ? '#10b981' : '#f8fafc' }}>
                          {credit ? '+' : '−'} GHS {Number(tx.amount).toFixed(2)}
                        </p>
                        {tx.balanceAfter !== null && tx.balanceAfter !== undefined && (
                          <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '3px' }}>balance GHS {Number(tx.balanceAfter).toFixed(2)}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
