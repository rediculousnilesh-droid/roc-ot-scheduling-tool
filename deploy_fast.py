"""
Fast deploy: uploads all files in a single Git commit using the Trees API.
Much faster than file-by-file upload.
"""
import base64, json, os, sys, urllib.request, urllib.error

REPO_NAME = "roc-ot-scheduling-tool"
BRANCH = "main"
SKIP_DIRS = {'node_modules', '.git', 'dist', 'data', '__pycache__'}
SKIP_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.svg'}

def read_token():
    for p in [os.path.join(os.path.dirname(__file__), '..', '.gh_token'),
              os.path.join(os.path.dirname(__file__), '.gh_token')]:
        if os.path.exists(p):
            with open(p, 'r') as f: return f.read().strip()
    return None

def api(url, token, method="GET", data=None):
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    body = json.dumps(data).encode() if data else None
    if body: headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode() if e.fp else str(e)}, e.code

def collect_files(base_dir):
    files = []
    for root, dirs, fnames in os.walk(base_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in fnames:
            if fn == '.gitkeep': continue
            ext = os.path.splitext(fn)[1].lower()
            if ext in SKIP_EXTS: continue
            fp = os.path.join(root, fn)
            rp = os.path.relpath(fp, base_dir).replace("\\", "/")
            try:
                with open(fp, "rb") as f: content = f.read()
                if len(content) > 1_000_000: continue
                files.append((rp, content))
            except: pass
    return files

def main():
    token = read_token()
    if not token: print("No token found"); sys.exit(1)

    base_url = f"https://api.github.com/repos"
    
    # Get username
    data, _ = api("https://api.github.com/user", token)
    owner = data["login"]
    print(f"Authenticated as: {owner}")
    repo_url = f"{base_url}/{owner}/{REPO_NAME}"

    # Create repo if needed
    data, status = api(f"{base_url}/{owner}/{REPO_NAME}", token)
    if status == 404:
        print("Creating repo...")
        api("https://api.github.com/user/repos", token, "POST",
            {"name": REPO_NAME, "description": "ROC OT Scheduling Tool", "private": False, "auto_init": True})
        import time; time.sleep(2)

    # Get the latest commit SHA on main
    data, status = api(f"{repo_url}/git/ref/heads/{BRANCH}", token)
    if status != 200:
        print(f"Error getting branch ref: {data}")
        sys.exit(1)
    latest_commit_sha = data["object"]["sha"]

    # Collect files
    base_dir = os.path.dirname(os.path.abspath(__file__))
    files = collect_files(base_dir)
    print(f"Collected {len(files)} files")

    # Create blobs for each file
    tree_items = []
    for i, (path, content) in enumerate(files):
        print(f"  Creating blob [{i+1}/{len(files)}]: {path}")
        blob_data, status = api(f"{repo_url}/git/blobs", token, "POST", {
            "content": base64.b64encode(content).decode(),
            "encoding": "base64"
        })
        if status != 201:
            print(f"    FAILED: {blob_data}")
            continue
        tree_items.append({
            "path": path,
            "mode": "100644",
            "type": "blob",
            "sha": blob_data["sha"]
        })

    print(f"\nCreating tree with {len(tree_items)} files...")
    tree_data, status = api(f"{repo_url}/git/trees", token, "POST", {
        "tree": tree_items
    })
    if status != 201:
        print(f"Failed to create tree: {tree_data}")
        sys.exit(1)

    print("Creating commit...")
    commit_data, status = api(f"{repo_url}/git/commits", token, "POST", {
        "message": "Deploy ROC OT Scheduling Tool",
        "tree": tree_data["sha"],
        "parents": [latest_commit_sha]
    })
    if status != 201:
        print(f"Failed to create commit: {commit_data}")
        sys.exit(1)

    print("Updating branch...")
    ref_data, status = api(f"{repo_url}/git/refs/heads/{BRANCH}", token, "PATCH", {
        "sha": commit_data["sha"]
    })
    if status != 200:
        print(f"Failed to update ref: {ref_data}")
        sys.exit(1)

    print(f"\n{'='*50}")
    print(f"SUCCESS! All {len(tree_items)} files deployed!")
    print(f"Repo: https://github.com/{owner}/{REPO_NAME}")
    print(f"\nNext: Deploy to Render.com")
    print(f"1. Go to https://render.com -> Sign up with GitHub")
    print(f"2. New -> Web Service -> Connect '{REPO_NAME}'")
    print(f"3. Build Command: cd client && npm install && npm run build && cd ../server && npm install")
    print(f"4. Start Command: cd server && npm start")
    print(f"5. Click 'Create Web Service'")
    print(f"{'='*50}")

if __name__ == "__main__":
    main()
