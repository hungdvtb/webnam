---
description: Commit changes automatically after completing a functional task or bug fix
---
1. Ensure all manual testing and verification for the current task are completed successfully.
2. Verify that there are no syntax errors or lint issues in the modified files.
3. Check the status of current changes using `git status`.
4. Stage the relevant files for the current task using `git add <filenames>`. 
   - Use `git add .` if all current changes are related to the same task.
5. Commit the staged changes with a concise and descriptive message following the format: `[type]: [short description]`.
   - Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`.
   - Example: `fix: handle null values in product grid to prevent 500 error`.
6. Inform the user that the task is complete and a commit has been made.
