<?php
require 'vendor/autoload.php'; // include Composer's autoloader

try {
    // Create a connection to MongoDB
    $client = new MongoDB\Client("mongodb://localhost:27017");
    $collection = $client->myblogsite->articles;
} catch (MongoDB\Driver\Exception\Exception $e) {
    die("Failed to connect to database: " . $e->getMessage());
}

$cursor = $collection->find();
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <link rel="stylesheet" href="css/style.css" />
    <title>My Blog Site</title>
</head>

<body>
    <div id="contentarea">
        <div id="innercontentarea">
            <h1>My Blogs</h1>
            <?php foreach ($cursor as $article): ?>
            <h2><?php echo htmlspecialchars($article['title'], ENT_QUOTES, 'UTF-8'); ?></h2>
            <p><?php echo htmlspecialchars(substr($article['content'], 0, 200), ENT_QUOTES, 'UTF-8') . '...'; ?></p>
            <a href="blog.php?id=<?php echo $article['_id']; ?>">Read more</a>
            <?php endforeach; ?>
        </div>
    </div>
</body>

</html>
