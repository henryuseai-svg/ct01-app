# Mở app CT01: bật máy chủ nội bộ (nếu chưa chạy) rồi mở app trong cửa sổ riêng.
# Chạy bằng pythonw nên không hiện cửa sổ đen.
import os, socket, subprocess, sys, time, webbrowser

PORT = 8765
URL = f'http://127.0.0.1:{PORT}/'
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def server_running():
    try:
        with socket.create_connection(('127.0.0.1', PORT), timeout=0.3):
            return True
    except OSError:
        return False


if not server_running():
    subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1', '--directory', APP_DIR],
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(50):
        if server_running():
            break
        time.sleep(0.1)

# Mở dạng cửa sổ app (không có thanh địa chỉ) bằng Chrome, không có thì Edge, cuối cùng là trình duyệt mặc định.
candidates = [
    os.path.expandvars(r'%ProgramFiles%\Google\Chrome\Application\chrome.exe'),
    os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
    os.path.expandvars(r'%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe'),
]
for exe in candidates:
    if os.path.exists(exe):
        subprocess.Popen([exe, f'--app={URL}'])
        break
else:
    webbrowser.open(URL)
