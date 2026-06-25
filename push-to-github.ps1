Write-Host "Step 1: Initializing Git repository..." -ForegroundColor Cyan
git init

Write-Host "Step 2: Staging all project files..." -ForegroundColor Cyan
git add .

Write-Host "Step 3: Committing files..." -ForegroundColor Cyan
git commit -m "Initial commit of n8n-flow multi-agent workspace"

Write-Host "Step 4: Ensuring main branch is selected..." -ForegroundColor Cyan
git branch -M main

Write-Host "Step 5: Setting remote origin to https://github.com/Muskan27Kumari/Multi-agents.git..." -ForegroundColor Cyan
# Remove origin if it already exists to avoid conflicts
git remote remove origin 2>$null
git remote add origin https://github.com/Muskan27Kumari/Multi-agents.git

Write-Host "Step 6: Pushing code to GitHub..." -ForegroundColor Cyan
git push -u origin main --force
