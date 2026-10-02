#!/usr/bin/env python3
"""
STUDS MoMo/payments regression suite.

Boots the API on a fresh SQLite DB with PAYMENT_PROVIDER=fake (deterministic,
no network, no real money) and verifies the financial-integrity properties:

  Phase 1 (fresh DB, fake provider):
    - auth guards: admin hole closed, 401s, 403s, /wallet/add gone (404)
    - top-up: validation, initiate creates NO credit, balance unchanged
    - webhook: bad signature -> 401 + no credit; unknown provider -> 404
    - webhook: valid charge.success -> exactly one TOPUP credit
    - webhook: replay + 5x concurrent duplicate delivery -> still one credit
    - webhook: tampered amount / unknown reference / charge.failed -> no credit
    - OTP endpoint wiring (fake accepts OTP, credit still only via webhook)
    - withdrawal: request reserves (available drops, balance unchanged),
      overspend rejected, approve initiates exactly one transfer (no debit),
      double-approve rejected, transfer.success -> exactly one debit,
      replay idempotent, transfer.failed -> no debit + reservation released
    - legacy flow: order checkout, delivery settlement conservation
      (31.00 debit = 21.25 + 6.00 + 3.75 credits), QR confirm
    - restart on same DB: balances and payment rows survive
  Phase 2 (fresh DB, FAKE_PROVIDER_*_STATUS=success):
    - top-up reconcile credits from authoritative provider status
    - withdrawal reconcile completes a stuck transfer with one debit
    - restart persistence re-verified on phase-2 DB.

Exit 0 only if every check passes.
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

ROOT = os.path.expanduser('~/workspace/studs')
BASE = 'http://127.0.0.1:3001'  # main.ts hardcodes the listen port
FAKE_SECRET = 'fake-webhook-secret-for-tests'
# Unique DB per run: concurrent runs (or a stray earlier run) must never share
# a database file or they will corrupt each other's results.
DB = f'/tmp/studs-paytest-{os.getpid()}.db'
LOG = '/tmp/studs-reg.log'

passed = 0
failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'  PASS  {name}', flush=True)
    else:
        failed += 1
        print(f'  FAIL  {name}' + (f'  <-- {detail}' if detail else ''), flush=True)


class API:
    def __init__(self, base):
        self.base = base

    def req(self, method, path, token=None, body=None, raw=None, headers=None):
        h = {'Content-Type': 'application/json'}
        if token:
            h['Authorization'] = f'Bearer {token}'
        if headers:
            h.update(headers)
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        r = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(r, timeout=20) as resp:
                txt = resp.read().decode()
                try:
                    return resp.status, json.loads(txt)
                except Exception:
                    return resp.status, txt
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            try:
                return e.code, json.loads(txt)
            except Exception:
                return e.code, txt
        except Exception as e:  # connection refused etc.
            return -1, str(e)


def port_free():
    import socket
    s = socket.socket()
    try:
        # The real server sets SO_REUSEADDR, so the probe must too; otherwise
        # leftover TIME_WAIT sockets from test traffic make a free port look
        # busy and the harness wrongly concludes a stale server is squatting.
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('127.0.0.1', 3001))
        return True
    except OSError:
        return False
    finally:
        s.close()


def kill_leftovers():
    # NOTE the [d] bracket trick: pkill must not match this python process's
    # own command line.
    subprocess.run(['pkill', '-f', '[d]ist/main'],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if port_free():
            return
        time.sleep(0.2)
    raise RuntimeError('could not free port 3001 from leftover servers')


def boot(db_path, extra_env=None, fresh=True):
    kill_leftovers()  # a stale server would silently hijack every check below
    env = dict(os.environ)
    env.update({
        'DATABASE_PATH': db_path,
        'PAYMENT_PROVIDER': 'fake',
        'JWT_SECRET': 'regression-test-secret-not-real',
        'ADMIN_SEED_EMAIL': 'admin@studs.app',
        'ADMIN_SEED_PASSWORD': 'AdminPass123!',
        'PORT': '3001',
        'FAKE_PROVIDER_WEBHOOK_SECRET': FAKE_SECRET,
        'FAKE_PROVIDER_CHARGE_STATUS': 'SUCCESS',
        'FAKE_PROVIDER_TRANSFER_STATUS': 'SUCCESS',
    })
    if extra_env:
        env.update(extra_env)
    if fresh and os.path.exists(db_path):
        os.remove(db_path)
    logf = open(LOG, 'a')
    proc = subprocess.Popen(['node', 'dist/main'], cwd=ROOT, env=env,
                            stdout=logf, stderr=subprocess.STDOUT)
    api = API(BASE)
    for _ in range(90):
        st, _ = api.req('GET', '/wallet', token='bogus')
        if st in (200, 401):
            return proc, api
        if proc.poll() is not None:
            raise RuntimeError('server exited during boot; see ' + LOG)
        time.sleep(0.5)
    proc.kill()
    raise RuntimeError('server did not start; see ' + LOG)


def stop(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    time.sleep(1)  # let the port release
    if not port_free():
        # terminate() didn't take; escalate so the next boot can't be hijacked
        try:
            proc.kill()
        except Exception:
            pass
        kill_leftovers()


@contextmanager
def running_server(db_path, extra_env=None, fresh=True):
    """Boot the API; guarantee the process is stopped on exit (even on crash)."""
    proc, api = boot(db_path, extra_env, fresh)
    try:
        yield api
    finally:
        stop(proc)


def signed_webhook(api, payload, secret=FAKE_SECRET, provider='fake'):
    body = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return api.req('POST', f'/payments/webhook/{provider}', raw=body,
                   headers={'Content-Type': 'application/json',
                            'x-fake-signature': sig})


def register(api, email, role):
    st, b = api.req('POST', '/auth/register',
                    body={'email': email, 'password': 'Pass12345!', 'role': role,
                          'name': email.split('@')[0], 'campusId': 'ug-legon'})
    assert st in (200, 201), f'register {email} -> {st} {b}'
    return b


def login(api, email, password='Pass12345!'):
    st, b = api.req('POST', '/auth/login',
                    body={'email': email, 'password': password})
    assert st in (200, 201), f'login failed for {email}: {st} {b}'
    return b['access_token']


def wallet(api, token):
    st, b = api.req('GET', '/wallet', token=token)
    assert st == 200, f'GET /wallet -> {st} {b}'
    return b


def txns(api, token):
    st, b = api.req('GET', '/wallet/transactions', token=token)
    assert st == 200, f'GET /wallet/transactions -> {st} {b}'
    return b if isinstance(b, list) else b.get('transactions', b)


# ---------------------------------------------------------------- phase 1 ---
def phase1():
    print('== Phase 1: fresh DB, fake provider ==', flush=True)
    with running_server(DB) as api:
        # ---- auth / guards ----
        st, _ = api.req('POST', '/auth/register',
                        body={'email': 'evil@gmail.com', 'password': 'Pass12345!',
                              'role': 'ADMIN', 'name': 'evil'})
        check('public registration rejects role=ADMIN', st == 400, f'status={st}')

        for role, email in [('STUDENT', 's1@studs.app'), ('VENDOR', 'v1@studs.app'),
                            ('RIDER', 'r1@studs.app')]:
            register(api, email, role)
            check(f'register {role}', True)
        s_tok = login(api, 's1@studs.app')
        v_tok = login(api, 'v1@studs.app')
        r_tok = login(api, 'r1@studs.app')
        a_tok = login(api, 'admin@studs.app', 'AdminPass123!')

        st, _ = api.req('GET', '/wallet')
        check('GET /wallet without token -> 401', st == 401, f'status={st}')
        st, _ = api.req('POST', '/wallet/add', token=s_tok, body={'amount': 10})
        check('POST /wallet/add is gone (404)', st == 404, f'status={st}')
        st, _ = api.req('POST', '/wallet/topup',
                        body={'amount': 10, 'momoNumber': '0551234987', 'network': 'MTN'})
        check('POST /wallet/topup without token -> 401', st == 401, f'status={st}')
        st, _ = api.req('PATCH', '/wallet/admin/withdrawals/x', token=s_tok,
                        body={'status': 'APPROVED'})
        check('student cannot approve withdrawals (403)', st == 403, f'status={st}')

        # ---- top-up validation ----
        for label, payload, want in [
            ('negative amount', {'amount': -5, 'momoNumber': '0551234987', 'network': 'MTN'}, 400),
            ('zero amount', {'amount': 0, 'momoNumber': '0551234987', 'network': 'MTN'}, 400),
            ('short phone', {'amount': 10, 'momoNumber': '123', 'network': 'MTN'}, 400),
            ('non-numeric phone', {'amount': 10, 'momoNumber': '055ABC4987', 'network': 'MTN'}, 400),
            ('missing network', {'amount': 10, 'momoNumber': '0551234987'}, 400),
            ('bad network', {'amount': 10, 'momoNumber': '0551234987', 'network': 'FOO'}, 400),
        ]:
            st, _ = api.req('POST', '/wallet/topup', token=s_tok, body=payload)
            check(f'topup validation: {label} -> {want}', st == want, f'status={st}')

        # ---- top-up initiate: no credit ----
        st, init = api.req('POST', '/wallet/topup', token=s_tok,
                           body={'amount': 50, 'momoNumber': '0551234987', 'network': 'MTN'})
        check('top-up initiate accepted', st in (200, 201) and init.get('status') == 'PENDING',
              f'status={st} body={init}')
        attempt_id = init.get('attemptId')
        ref = init.get('providerReference')
        w = wallet(api, s_tok)
        check('initiate creates NO credit (balance 0)',
              w.get('balance') == 0 and w.get('available') == 0, f'{w}')
        check('initiate creates NO ledger entries', txns(api, s_tok) == [])
        st, att = api.req('GET', f'/wallet/topup/{attempt_id}', token=s_tok)
        check('attempt visible as PENDING', st == 200 and att.get('status') == 'PENDING',
              f'status={st} body={att}')

        # ---- webhook: bad signature / unknown provider ----
        good_payload = {'kind': 'CHARGE_SUCCESS', 'rawEvent': 'charge.success',
                        'eventId': 'evt_good_1', 'reference': ref,
                        'amountMinor': 5000, 'currency': 'GHS'}
        st, _ = signed_webhook(api, good_payload, secret='wrong-secret')
        check('webhook with bad signature -> 401', st == 401, f'status={st}')
        check('bad signature creates no credit', wallet(api, s_tok).get('balance') == 0)
        st, _ = signed_webhook(api, good_payload, provider='nope')
        check('webhook for unknown provider -> 404', st == 404, f'status={st}')

        # ---- webhook: valid charge.success -> exactly one credit ----
        st, _ = signed_webhook(api, good_payload)
        check('valid charge.success webhook accepted', st == 200, f'status={st}')
        w = wallet(api, s_tok)
        check('verified success credits exactly 50', w.get('balance') == 50, f'{w}')
        entries = [t for t in txns(api, s_tok)
                   if t.get('reason') == 'TOPUP' and t.get('type') == 'CREDIT']
        check('exactly one TOPUP ledger entry',
              len(entries) == 1 and float(entries[0]['amount']) == 50, f'{entries}')
        st, att = api.req('GET', f'/wallet/topup/{attempt_id}', token=s_tok)
        check('attempt marked SUCCESS', att.get('status') == 'SUCCESS', f'{att}')

        # ---- webhook: replay + concurrent duplicates stay at one credit ----
        st, _ = signed_webhook(api, good_payload)  # same eventId replay
        check('replayed event still 200', st == 200, f'status={st}')
        dup_payloads = [dict(good_payload, eventId=f'evt_dup_{i}') for i in range(5)]
        with ThreadPoolExecutor(max_workers=5) as ex:
            results = list(ex.map(lambda p: signed_webhook(api, p)[0], dup_payloads))
        check('concurrent duplicate deliveries all accepted', all(s == 200 for s in results),
              f'{results}')
        check('balance still exactly 50 after replay+concurrency',
              wallet(api, s_tok).get('balance') == 50)
        entries = [t for t in txns(api, s_tok)
                   if t.get('reason') == 'TOPUP' and t.get('type') == 'CREDIT']
        check('still exactly one TOPUP entry', len(entries) == 1, f'count={len(entries)}')

        # ---- webhook: tampering / unknown / failure -> no credit ----
        st, init2 = api.req('POST', '/wallet/topup', token=s_tok,
                            body={'amount': 20, 'momoNumber': '0551234987', 'network': 'MTN'})
        ref2 = init2['providerReference']
        tampered = {'kind': 'CHARGE_SUCCESS', 'rawEvent': 'charge.success',
                    'eventId': 'evt_tamper_1', 'reference': ref2,
                    'amountMinor': 999900, 'currency': 'GHS'}
        st, _ = signed_webhook(api, tampered)
        check('tampered amount: webhook received (200)', st == 200, f'status={st}')
        check('tampered amount: NO credit', wallet(api, s_tok).get('balance') == 50)
        unknown = {'kind': 'CHARGE_SUCCESS', 'rawEvent': 'charge.success',
                   'eventId': 'evt_unknown_1', 'reference': 'studs_topup_nope',
                   'amountMinor': 1000, 'currency': 'GHS'}
        st, _ = signed_webhook(api, unknown)
        check('unknown reference: webhook received (200)', st == 200, f'status={st}')
        check('unknown reference: NO credit', wallet(api, s_tok).get('balance') == 50)
        failed_evt = {'kind': 'CHARGE_FAILED', 'rawEvent': 'charge.failed',
                      'eventId': 'evt_fail_1', 'reference': ref2,
                      'amountMinor': 2000, 'currency': 'GHS'}
        st, _ = signed_webhook(api, failed_evt)
        check('charge.failed: NO credit', wallet(api, s_tok).get('balance') == 50)
        st, att = api.req('GET', f"/wallet/topup/{init2['attemptId']}", token=s_tok)
        check('failed attempt not marked SUCCESS', att.get('status') != 'SUCCESS', f'{att}')

        # ---- OTP endpoint wiring (fake accepts 4-8 digit OTP) ----
        st, init3 = api.req('POST', '/wallet/topup', token=s_tok,
                            body={'amount': 15, 'momoNumber': '0201234567', 'network': 'VODAFONE'})
        st, _ = api.req('POST', f"/wallet/topup/{init3['attemptId']}/otp",
                        token=s_tok, body={'otp': '12'})
        check('bad OTP rejected (400)', st == 400, f'status={st}')
        st, o = api.req('POST', f"/wallet/topup/{init3['attemptId']}/otp",
                        token=s_tok, body={'otp': '1234'})
        check('OTP accepted, still PENDING (no direct credit)', st in (200, 201),
              f'status={st} body={o}')
        check('OTP alone credits nothing', wallet(api, s_tok).get('balance') == 50)
        st, _ = signed_webhook(api, {'kind': 'CHARGE_SUCCESS', 'rawEvent': 'charge.success',
                                     'eventId': 'evt_otp_1', 'reference': init3['providerReference'],
                                     'amountMinor': 1500, 'currency': 'GHS'})
        check('OTP top-up credited only via verified webhook',
              wallet(api, s_tok).get('balance') == 65)

        # ---- withdrawal: reserve -> approve -> transfer -> debit ----
        st, wd = api.req('POST', '/wallet/withdraw', token=s_tok,
                         body={'amount': 20, 'momoNumber': '0244123456', 'network': 'MTN'})
        check('withdrawal request accepted (PENDING)',
              st in (200, 201) and wd.get('status') == 'PENDING', f'status={st} body={wd}')
        w = wallet(api, s_tok)
        check('reservation: balance 65, available 45',
              w.get('balance') == 65 and w.get('available') == 45, f'{w}')
        st, _ = api.req('POST', '/wallet/withdraw', token=s_tok,
                        body={'amount': 50, 'momoNumber': '0244123456', 'network': 'MTN'})
        check('withdrawal exceeding available rejected (400)', st == 400, f'status={st}')

        st, ap = api.req('PATCH', f"/wallet/admin/withdrawals/{wd['id']}", token=a_tok,
                         body={'status': 'APPROVED'})
        check('admin approve initiates transfer', st == 200 and ap.get('transferCode'),
              f'status={st} body={ap}')
        check('approve creates NO debit yet', wallet(api, s_tok).get('balance') == 65)
        w = wallet(api, s_tok)
        check('funds still reserved after approve', w.get('available') == 45, f'{w}')
        st, _ = api.req('PATCH', f"/wallet/admin/withdrawals/{wd['id']}", token=a_tok,
                        body={'status': 'APPROVED'})
        check('double approve rejected (400)', st == 400, f'status={st}')

        st, _ = signed_webhook(api, {'kind': 'TRANSFER_SUCCESS', 'rawEvent': 'transfer.success',
                                     'eventId': 'evt_tx_1', 'reference': ap['providerReference'],
                                     'amountMinor': 2000, 'currency': 'GHS',
                                     'transferCode': ap['transferCode']})
        check('transfer.success webhook accepted', st == 200, f'status={st}')
        w = wallet(api, s_tok)
        check('transfer success debits exactly 20 (balance 45)',
              w.get('balance') == 45 and w.get('available') == 45, f'{w}')
        debits = [t for t in txns(api, s_tok)
                  if t.get('reason') == 'WITHDRAWAL' and t.get('type') == 'DEBIT']
        check('exactly one WITHDRAWAL debit of 20',
              len(debits) == 1 and float(debits[0]['amount']) == 20, f'{debits}')
        st, _ = signed_webhook(api, {'kind': 'TRANSFER_SUCCESS', 'rawEvent': 'transfer.success',
                                     'eventId': 'evt_tx_1b', 'reference': ap['providerReference'],
                                     'amountMinor': 2000, 'currency': 'GHS',
                                     'transferCode': ap['transferCode']})
        check('duplicate transfer.success stays at one debit',
              wallet(api, s_tok).get('balance') == 45)

        # ---- withdrawal: transfer.failed releases reservation, no debit ----
        st, wd2 = api.req('POST', '/wallet/withdraw', token=s_tok,
                          body={'amount': 10, 'momoNumber': '0244123456', 'network': 'MTN'})
        st, ap2 = api.req('PATCH', f"/wallet/admin/withdrawals/{wd2['id']}", token=a_tok,
                          body={'status': 'APPROVED'})
        st, _ = signed_webhook(api, {'kind': 'TRANSFER_FAILED', 'rawEvent': 'transfer.failed',
                                     'eventId': 'evt_tx_2', 'reference': ap2['providerReference'],
                                     'amountMinor': 1000, 'currency': 'GHS',
                                     'transferCode': ap2['transferCode']})
        w = wallet(api, s_tok)
        check('transfer.failed: no debit, reservation released (45/45)',
              w.get('balance') == 45 and w.get('available') == 45, f'{w}')

        # ---- legacy order flow + settlement conservation ----
        st, mi = api.req('POST', '/menu-items', token=v_tok,
                         body={'name': 'Jollof', 'price': 25,
                               'description': 'tasty', 'campusId': 'ug-legon'})
        check('vendor creates menu item', st in (200, 201), f'status={st} body={mi}')
        st, o = api.req('POST', '/orders', token=s_tok,
                        body={'vendorId': mi['vendorId'], 'campusId': 'ug-legon',
                              'deliveryLocation': 'Hall A', 'menuItemIds': [mi['id']],
                              'deliveryFee': 6})
        check('student places order (31.00)', st in (200, 201), f'status={st} body={o}')
        order_id = o['orderId']
        w = wallet(api, s_tok)
        check('checkout debited 31 (balance 14)', w.get('balance') == 14, f'{w}')
        st, va = api.req('POST', f'/orders/{order_id}/vendor-accept', token=v_tok)
        check('vendor accepts PENDING order', st in (200, 201), f'status={st} body={va}')
        st, _ = api.req('POST', '/orders/rider/clock-in', token=r_tok)
        st, _ = api.req('POST', f'/orders/{order_id}/accept', token=r_tok)
        st, cf = api.req('POST', f'/orders/{order_id}/confirm', token=r_tok,
                         body={'qrCodeScanned': order_id})
        check('rider confirms delivery (QR)', st in (200, 201), f'status={st} body={cf}')
        sv, vv, rv = (wallet(api, t).get('balance') for t in (s_tok, v_tok, r_tok))
        check('settlement: student 14, vendor 21.25, rider 6',
              sv == 14 and vv == 21.25 and rv == 6, f's={sv} v={vv} r={rv}')
        vp = [t for t in txns(api, v_tok) if t.get('reason') == 'VENDOR_PAYOUT']
        rp = [t for t in txns(api, r_tok) if t.get('reason') == 'RIDER_PAYOUT']
        op = [t for t in txns(api, s_tok) if t.get('reason') == 'ORDER_PAYMENT']
        check('money conserved: 31.00 debit == 21.25 + 6.00 + 3.75 ledger split',
              len(op) == 1 and float(op[0]['amount']) == 31
              and len(vp) == 1 and float(vp[0]['amount']) == 21.25
              and len(rp) == 1 and float(rp[0]['amount']) == 6,
              f'op={op} vp={vp} rp={rp}')

    # ---- persistence across restart ----
    print('  -- restarting on same DB --', flush=True)
    with running_server(DB, fresh=False) as api2:
        s_tok = login(api2, 's1@studs.app')
        w = wallet(api2, s_tok)
        check('balances survive restart', w.get('balance') == 14, f'{w}')
        st, att = api2.req('GET', f'/wallet/topup/{attempt_id}', token=s_tok)
        check('payment attempts survive restart', st == 200 and att.get('status') == 'SUCCESS',
              f'status={st} body={att}')


# ---------------------------------------------------------------- phase 2 ---
def phase2():
    """Reconcile paths with the fake provider forced to authoritative success."""
    print('== Phase 2: reconcile from provider status ==', flush=True)
    with running_server(DB, extra_env={'FAKE_PROVIDER_CHARGE_STATUS': 'SUCCESS',
                                       'FAKE_PROVIDER_TRANSFER_STATUS': 'SUCCESS'}) as api:
        register(api, 's2@studs.app', 'STUDENT')
        s_tok = login(api, 's2@studs.app')
        a_tok = login(api, 'admin@studs.app', 'AdminPass123!')

        # top-up: initiate (PENDING), no webhook; reconcile queries the provider.
        st, init = api.req('POST', '/wallet/topup', token=s_tok,
                           body={'amount': 40, 'momoNumber': '0551234987', 'network': 'MTN'})
        check('reconcile setup: top-up initiated', st in (200, 201), f'status={st}')
        check('reconcile setup: no credit before reconcile',
              wallet(api, s_tok).get('balance') == 0)
        st, rc = api.req('POST', f"/wallet/topup/{init['attemptId']}/reconcile", token=s_tok)
        check('top-up reconcile credits from provider status',
              st in (200, 201) and wallet(api, s_tok).get('balance') == 40,
              f'status={st} body={rc}')
        st, _ = api.req('POST', f"/wallet/topup/{init['attemptId']}/reconcile", token=s_tok)
        check('top-up reconcile is idempotent (still 40)',
              wallet(api, s_tok).get('balance') == 40)

        # withdrawal: request -> approve -> no webhook; reconcile completes it.
        st, wd = api.req('POST', '/wallet/withdraw', token=s_tok,
                         body={'amount': 12, 'momoNumber': '0244123456', 'network': 'MTN'})
        st, ap = api.req('PATCH', f"/wallet/admin/withdrawals/{wd['id']}", token=a_tok,
                         body={'status': 'APPROVED'})
        check('reconcile setup: transfer initiated, no debit yet',
              wallet(api, s_tok).get('balance') == 40)
        st, rc = api.req('POST', f"/wallet/admin/withdrawals/{wd['id']}/reconcile", token=a_tok)
        w = wallet(api, s_tok)
        check('withdrawal reconcile completes with one debit (28/28)',
              st in (200, 201) and w.get('balance') == 28 and w.get('available') == 28,
              f'status={st} body={rc} wallet={w}')
        debits = [t for t in txns(api, s_tok)
                  if t.get('reason') == 'WITHDRAWAL' and t.get('type') == 'DEBIT']
        check('exactly one WITHDRAWAL debit after reconcile', len(debits) == 1, f'{debits}')
        st, _ = api.req('POST', f"/wallet/admin/withdrawals/{wd['id']}/reconcile", token=a_tok)
        check('withdrawal reconcile idempotent (still 28)',
              wallet(api, s_tok).get('balance') == 28)

    print('  -- restarting phase-2 DB --', flush=True)
    with running_server(DB, fresh=False) as api2:
        w = wallet(api2, login(api2, 's2@studs.app'))
        check('phase-2 state survives restart', w.get('balance') == 28, f'{w}')


def main():
    global passed, failed
    if os.path.exists(LOG):
        os.remove(LOG)
    print('== rebuilding backend ==', flush=True)
    r = subprocess.run(['npm', 'run', 'build'], cwd=ROOT,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print('BUILD FAILED')
        return 1
    print('build green', flush=True)
    for name, fn in (('phase1', phase1), ('phase2', phase2)):
        try:
            fn()
        except Exception as e:
            failed += 1
            print(f'  FAIL  {name} crashed: {e}', flush=True)
    print(f'\n{passed} passed, {failed} failed', flush=True)
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
