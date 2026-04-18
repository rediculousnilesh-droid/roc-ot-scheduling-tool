"""
Upload ROC OT Scheduling Tool to GitHub via the API.
Reads token from ../.gh_token file. No Git CLI required.

Usage: python deploy_to_github.py
"""
import base64
import json
import os
import sys
import urllib.request
import urllib.error

REPO_NAME = "roc-ot-scheduling-tool"
BRANCH = "main"

# Files/folders to skip
SKIP_DIRS = {'node_modules', '.git', 'data'}
SKIP_FILES = {'.gitkeep'}

def read_token():
    # Try parent directory first, then current
    for p in [os.path.join(os.path.dirname(__file__), '..', '.gh_token'),
              os.path.join(os.path.dirname(__file__), '.gh_token')]:
        if os.path.exists(p):
            with open(p, 'r') as f:
                return f.read().strip()
    return None

def api_request(url, token, method="GET", data=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode("utf-8")
    else:
        body = None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8")), resp.status
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        return {"error": error_body, "status": e.code}, e.code

def get_username(token):
    data, status = api_request("https://api.github.com/user", token)
    if status != 200:
        print(f"Failed to get user info: {data}")
        sys.exit(1)
    return data["login"]

def create_repo(token, repo_name):
    print(f"Creating repository '{repo_name}'...")
    data, status = api_request(
        "https://api.github.com/user/repos", token, method="POST",
        data={"name": repo_name, "description": "ROC OT Scheduling Tool", "private": False, "auto_init": True},
    )
    if status == 201:
        print("Repository created!")
        return True
    elif status == 422 and "already exists" in str(data):
        print("Repository already exists, will update files.")
        return True
    else:
        print(f"Failed to create repo: {data}")
        return False

def get_file_sha(token, owner, repo, path):
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={BRANCH}"
    data, status = api_request(url, token)
    if status == 200:
        return data.get("sha")
    return None

def upload_file(token, owner, repo, file_path, content_bytes, message):
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{file_path}"
    encoded = base64.b64encode(content_bytes).decode("utf-8")
    payload = {"message": message, "content": encoded, "branch": BRANCH}
    sha = get_file_sha(token, owner, repo, file_path)
    if sha:
        payload["sha"] = sha
    data, status = api_request(url, token, method="PUT", data=payload)
    if status in (200, 201):
        return True
    else:
        print(f"  FAILED: {file_path} - {data.get('error', data)}")
        return False

def collect_files(base_dir):
    """Collect all project files, skipping node_modules, dist, data, etc."""
    files = []
    for root, dirs, filenames in os.walk(base_dir):
        # Skip unwanted directories
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        
        for filename in filenames:
            if filename in SKIP_FILES:
                continue
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, base_dir).replace("\\", "/")
            
            # Skip binary/large files
            if filename.endswith(('.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot')):
                continue
            
            try:
                with open(full_path, "rb") as f:
                    content = f.read()
                # Skip files larger than 1MB
                if len(content) > 1_000_000:
                    print(f"  Skipping (too large): {rel_path}")
                    continue
                files.append((rel_path, content))
            except Exception as e:
                print(f"  Skipping (read error): {rel_path} - {e}")
    return files

def main():
    token = read_token()
    if not token:
        print("Error: No .gh_token file found")
        sys.exit(1)

    print("Authenticating with GitHub...")
    username = get_username(token)
    print(f"Authenticated as: {username}")

    create_repo(token, REPO_NAME)

    # Collect all project files
    base_dir = os.path.dirname(os.path.abspath(__file__))
    files = collect_files(base_dir)
    print(f"\nUploading {len(files)} files to {username}/{REPO_NAME}...")

    success = 0
    for i, (rel_path, content) in enumerate(files):
        print(f"  [{i+1}/{len(files)}] {rel_path}")
        if upload_file(token, username, REPO_NAME, rel_path, content, f"Deploy: {rel_path}"):
            success += 1

    print(f"\nDone! {success}/{len(files)} files uploaded.")
    print(f"\nYour repo: https://github.com/{username}/{REPO_NAME}")
    print(f"\nNext steps for Render.com deployment:")
    print(f"1. Go to https://render.com and sign up with GitHub")
    print(f"2. Click 'New' -> 'Web Service'")
    print(f"3. Connect your '{REPO_NAME}' repository")
    print(f"4. Set these settings:")
    print(f"   - Build Command: cd client && npm install && npm run build && cd ../server && npm install")
    print(f"   - Start Command: cd server && npm start")
    print(f"5. Click 'Create Web Service'")
    print(f"6. Wait ~3 minutes for deploy")
    print(f"7. Share the URL with your team!")

if __name__ == "__main__":
    main()
