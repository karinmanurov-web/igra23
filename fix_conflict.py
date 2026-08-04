with open("server.js", "r") as f:
    content = f.read()

content = content.replace("<<<<<<< HEAD\n", "")
content = content.replace("=======\n", "")
content = content.replace(">>>>>>> origin/main\n", "")

with open("server.js", "w") as f:
    f.write(content)
