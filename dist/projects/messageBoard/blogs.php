<?php
    try {
        $connection = new Mongo();
        $database = $connection->selectDB('myblogsite');
        $collection = $database->selectCollection('articles');
    } catch(MongoConnectionException $e) {
        die("Failed to connect to database ".$e->getMessage());
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
            <?php while ($cursor->hasNext()): $article = $cursor->getNext(); ?>
            <h2>
                <?php echo $article['title']; ?>
            </h2>
            <p>
                <?php echo substr($article['content'], 0, 200).'...'; ?>
            </p>
            <a href="blog.php?id=<?php echo $article['_id'];
            ?>">Read more</a>
            <?php endwhile; ?>
        </div>
    </div>
</body>

</html>